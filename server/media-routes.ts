import { chunkUpload } from './media-chunk-upload';
import { finishMediaWrite, purgeNextPersonalUpload } from "./media-erasure";
import type { Express } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { requireAuth } from './auth-middleware';
import { retainerPool, retainerTransaction } from './retainer-v1-db';
import { assertProjectParty } from './project-access';
import { hasVerifiedProjectPayment } from './project-payment-verification';
import { STORAGE_CONFIGURED, putPrivateObject, readPrivateObject, createPresignedDownloadUrl, deleteObject, multipartObjectStorage } from './object-storage';
import { createMultipartMediaService } from './media-multipart';
import { authorizeMediaUpload, publishCustomUpload } from './media-upload-access';
import { mediaUploadLimit, mediaUploadLimitLabel } from '../shared/media-upload';
import { renderRetainerPreview } from './retainer-v1-media';
import { PUBLIC_MEDIA_SCOPES, MEDIA_MIMES, canReadMedia, mediaPath } from './media-policy';
const upload = multer({ dest: tmpdir(), limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 0 }, fileFilter: (_req, file, cb) => cb(null, MEDIA_MIMES.has(file.mimetype)) });
const db = () => retainerPool();
const multipart = createMultipartMediaService({ transaction: retainerTransaction, storage: multipartObjectStorage, authorize: authorizeMediaUpload, publishCustom: publishCustomUpload });
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
function error(res: any, e: any) { res.status(e.status || (e.code === 'LIMIT_FILE_SIZE' ? 413 : 500)).json({ error: e.status ? e.message : e.code === 'LIMIT_FILE_SIZE' ? 'Maximum upload size is 200 MB.' : 'Unable to process media. Please retry.' }); }
export function registerMediaRoutes(app: Express) {
  app.post('/api/media/uploads/:scope', requireAuth, rateLimit({ windowMs: 60_000, limit: 10, keyGenerator: req => String(req.auth!.userId) }), async (req, res) => {
    try {
      if (!STORAGE_CONFIGURED) fail(503, 'File storage is not configured.');
      res.status(201).json(await multipart.start(req.auth!.userId, String(req.params.scope), req.body));
    } catch (e) { error(res, e); }
  });
  app.put('/api/media/uploads/:id/parts/:part', requireAuth, async (req, res) => {
    try {
      const id = Number(req.params.id), part = Number(req.params.part);
      if (!Number.isSafeInteger(id) || !Number.isSafeInteger(part) || id < 1 || part < 1) fail(400, 'Invalid upload chunk.');
      if (!(await db().query("SELECT id FROM upload_objects WHERE id=$1 AND owner_user_id=$2 AND multipart_upload_id IS NOT NULL AND status='media_uploading' AND upload_intent_expires_at::timestamptz > NOW()", [id, req.auth!.userId])).rows.length) fail(404, 'Upload not found or expired.');
      await new Promise<void>((resolve, reject) => chunkUpload.single('file')(req, res, e => e ? reject(e) : resolve()));
      if (!req.file) fail(400, 'Choose an upload chunk.');
      res.json(await multipart.part(req.auth!.userId, id, part, req.file!));
    } catch (e: any) {
      if (e.code === 'LIMIT_FILE_SIZE') res.status(413).json({ error: 'Upload chunk exceeds 8 MB.' });
      else error(res, e);
    } finally { if (req.file) await rm(req.file.path, { force: true }); }
  });
  app.post('/api/media/uploads/:id/complete', requireAuth, async (req, res) => {
    try { res.status(202).json(await multipart.complete(req.auth!.userId, Number(req.params.id))); }
    catch (e) { error(res, e); }
  });
  app.delete('/api/media/uploads/:id', requireAuth, async (req, res) => {
    try { await multipart.abort(req.auth!.userId, Number(req.params.id)); res.sendStatus(204); }
    catch (e) { error(res, e); }
  });
  app.post('/api/media/upload/:scope', requireAuth, rateLimit({windowMs: 60_000, limit: 10}), async (req, res) => {
    try {
      if (!STORAGE_CONFIGURED) fail(503, 'File storage is not configured.');
      const scope = String(req.params.scope), projectId = Number(req.query.projectId);
      if (!PUBLIC_MEDIA_SCOPES.has(scope) && scope !== 'delivery' && scope !== 'cycle') fail(400, 'Invalid upload purpose.');
      let resourceId=projectId;
      if (scope === 'cycle') {
        if (process.env.RETAINER_PRIVATE_STORAGE_CONFIRMED !== 'true') fail(503,'Private storage must be confirmed.');
        const task=(await db().query(`SELECT t.id,t.status,c.status AS cycle_status,a.freelancer_id,a.workflow_version FROM retainer_cycle_tasks t JOIN retainer_cycles c ON c.id=t.retainer_cycle_id JOIN retainer_agreements a ON a.id=c.retainer_agreement_id WHERE a.public_id=$1 AND t.public_id=$2`,[req.query.retainerId,req.query.taskId])).rows[0];
        if(!task || task.freelancer_id!==req.auth!.userId || task.workflow_version===1 || task.status==='complete' || !['active','due','awaiting_payment'].includes(task.cycle_status)) fail(403,'This work item is not open for uploads.');
        resourceId=task.id;
      }
      if (scope === 'delivery') {
        if (process.env.RETAINER_PRIVATE_STORAGE_CONFIRMED !== 'true') fail(503, 'Private storage must be confirmed before uploading work.');
        const { project, role } = await assertProjectParty(projectId, req.auth!.userId);
        if (project.isRetainer === 1) fail(400, 'Upload retainer work from its cycle workspace.');
        if (role !== 'freelancer' || ['completed', 'cancelled'].includes(project.status)) fail(403, 'This project is not open for freelancer uploads.');
      }
      upload.single('file')(req, res, async (uploadError) => {
        if (uploadError) return error(res, uploadError);
        const file = req.file;
        if (!file) return res.status(400).json({error:'Choose a JPEG, PNG, WebP, MP4, MOV or WebM file.'});
        try {
          if (scope === 'profile' && (!file.mimetype.startsWith('image/') || file.size > 5 * 1024 * 1024)) fail(400, 'Choose a profile image under 5 MB.');
          if (file.size > mediaUploadLimit(scope)) fail(400, `Maximum file size is ${mediaUploadLimitLabel(scope)}.`);
          const key = `media/${randomUUID()}`;
          // Persist the key before writing bytes, so an interrupted upload is recoverable.
          const row = (await db().query(`INSERT INTO upload_objects (owner_user_id,object_key,resource_type,resource_id,mime_type,original_filename,size_bytes,status,upload_intent_expires_at,created_at) SELECT $1,$2,$3,$4,$5,$6,$7,'media_uploading',$8,$8 FROM users WHERE id=$1 AND account_status='active' RETURNING *`, [req.auth!.userId,key,`media_${scope}`,['delivery','cycle'].includes(scope) ? resourceId : null,file.mimetype,file.originalname.replace(/[\x00-\x1f]/g,'').slice(0,180),file.size,new Date().toISOString()])).rows[0];
          if (!row) fail(403, 'This account is no longer active.');
          await putPrivateObject(key, createReadStream(file.path), file.mimetype, file.size);
          if (!(await finishMediaWrite(db(), row.id, 'media_uploading', 'media_queued'))) fail(409, 'This upload is no longer available.');
          res.status(202).json({id:row.id,status:'media_queued'});
        } catch(e) { error(res,e); } finally { await rm(file.path,{force:true}); }
      });
    } catch(e) { error(res,e); }
  });
  app.get('/api/media/status/:id', requireAuth, async (req,res) => {
    try {
      const row=(await db().query('SELECT * FROM upload_objects WHERE id=$1 AND owner_user_id=$2 AND resource_type LIKE $3',[req.params.id,req.auth!.userId,'media_%'])).rows[0];
      if (!row) fail(404,'Upload not found.');
      res.set('Cache-Control','no-store').json({id:row.id,status:row.status,...(row.status === 'ready' ? {url:mediaPath(row),mime:row.mime_type} : {})});
    } catch(e) { error(res,e); }
  });
  app.post('/api/media/retry/:id', requireAuth, async (req,res) => {
    try {
      const result=await db().query("UPDATE upload_objects SET status='media_queued' WHERE id=$1 AND owner_user_id=$2 AND status='media_failed' RETURNING id",[req.params.id,req.auth!.userId]);
      if (!result.rows.length) fail(409,'This upload cannot be retried.');
      res.json({id:result.rows[0].id});
    } catch(e) { error(res,e); }
  });
  app.get('/api/media/:id/:token/:variant', async (req,res,next) => {
    try {
      const row=(await db().query("SELECT * FROM upload_objects WHERE id=$1 AND status='ready' AND resource_type LIKE 'media_%' AND (resource_type NOT IN ('media_feed','media_profile','media_portfolio') OR EXISTS (SELECT 1 FROM users WHERE users.id=owner_user_id AND account_status='active'))",[req.params.id])).rows[0];
      if (!row || row.object_key !== `media/${req.params.token}`) fail(404,'Media not found.');
      const preview=String(req.params.variant).startsWith('preview.'), scope=row.resource_type.slice(6);
      const serve = async () => {
        try {
          let party=false, paid=false;
          if(scope==='cycle') {
            const cycle=(await db().query(`SELECT a.client_id,a.freelancer_id,c.paid_at,p.status,p.succeeded_at,p.stripe_payment_intent_id,p.id AS payment_id,p.gross_pence FROM retainer_cycle_tasks t JOIN retainer_cycles c ON c.id=t.retainer_cycle_id JOIN retainer_agreements a ON a.id=c.retainer_agreement_id LEFT JOIN payments p ON p.id=c.payment_id AND p.retainer_cycle_id=c.id WHERE t.id=$1`,[row.resource_id])).rows[0];
            party=!!cycle && [cycle.client_id,cycle.freelancer_id].includes(req.auth!.userId);
            if(!party)fail(403,'Not authorised.');
            const refunds=cycle.payment_id ? (await db().query("SELECT COALESCE(SUM(amount_pence),0)::bigint AS amount FROM payment_refunds WHERE payment_id=$1 AND status='succeeded'",[cycle.payment_id])).rows[0] : null;
            paid=!!cycle.paid_at && !!cycle.succeeded_at && !!cycle.stripe_payment_intent_id && ['succeeded','partially_refunded'].includes(cycle.status) && Number(refunds?.amount??0)<Number(cycle.gross_pence);
          } else if (!PUBLIC_MEDIA_SCOPES.has(scope)) {
            const {project}=await assertProjectParty(row.resource_id,req.auth!.userId);
            party=true;
            paid=project.isRetainer !== 1 && await hasVerifiedProjectPayment(project.id);
          }
          if (!canReadMedia(scope,row.owner_user_id === req.auth?.userId,party,preview,paid)) fail(403,'Verified payment is required to download the original.');
          res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});
          const url=await createPresignedDownloadUrl(preview ? `${row.object_key}.preview` : row.object_key,60, !preview && ['delivery','cycle'].includes(scope) ? row.original_filename : undefined);
          if(req.query.resolve === '1')res.json({url});else res.redirect(302,url);
        } catch(e) { error(res,e); }
      };
      if (PUBLIC_MEDIA_SCOPES.has(scope)) await serve(); else requireAuth(req,res,()=>{void serve();});
    } catch(e) { error(res,e); }
  });
}
// Durable queue; process one file at a time, recover interrupted processing after restart.
export async function processNextMedia() {
  const row=(await db().query(`UPDATE upload_objects SET status='media_processing', confirmed_at=$1 WHERE id=(SELECT id FROM upload_objects WHERE status='media_queued' OR (status='media_processing' AND confirmed_at::timestamptz < NOW()-INTERVAL '20 minutes') ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[new Date().toISOString()])).rows[0];
  if (!row) return;
  const folder=await mkdtemp(join(tmpdir(),'viewrr-media-'));
  try {
    const input=join(folder,'input'), output=join(folder,row.mime_type.startsWith('video/') ? 'preview.mp4' : 'preview.jpg');
    await pipeline(await readPrivateObject(row.object_key),createWriteStream(input));
    await renderRetainerPreview(input,output,row.mime_type);
    await putPrivateObject(`${row.object_key}.preview`,createReadStream(output),row.mime_type.startsWith('video/') ? 'video/mp4' : 'image/jpeg',(await stat(output)).size);
    await finishMediaWrite(db(),row.id,'media_processing','ready');
  } catch(e) {
    await finishMediaWrite(db(),row.id,'media_processing','media_failed');
    console.error('[media] Preview failed for upload',row.id);
  } finally { await rm(folder,{recursive:true,force:true}); }
}
let started=false;
export function startMediaWorker() {
  if (started || !STORAGE_CONFIGURED) return;
  started=true; let busy=false;
  const tick=async()=>{if(busy)return;busy=true;try{await multipart.cleanup();await purgeNextPersonalUpload(db(),deleteObject);}catch{console.error('[media] Upload cleanup will retry');}try{await processNextMedia();}catch{console.error('[media] Queue unavailable');}finally{busy=false;}};
  void tick();setInterval(()=>void tick(),5000).unref();
}
