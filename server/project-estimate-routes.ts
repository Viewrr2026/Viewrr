import type { Express,Request,Response } from 'express';
import { z } from 'zod';
import { requireAuth } from './auth-middleware';
import { projectEstimates,proposeEstimate,reviewEstimate } from './project-estimates';
import { storage } from './storage';
const route=(fn:(req:Request)=>Promise<unknown>)=>async(req:Request,res:Response)=>{
  try {res.set('Cache-Control','private, no-store');res.json(await fn(req));}
  catch(e:any){res.status(e instanceof z.ZodError?400:e.status??500).json({error:e instanceof z.ZodError?'Check the estimate items and amounts.':e.status?e.message:'Unable to save the estimate.'});}
};
export function registerProjectEstimateRoutes(app:Express) {
  app.get('/api/projects/:id/estimates',requireAuth,route(req=>projectEstimates(Number(req.params.id),req.auth!.userId)));
  app.post('/api/projects/:id/estimates',requireAuth,route(async req=>{
    const id=Number(req.params.id),uid=req.auth!.userId;
    const version=await proposeEstimate(id,uid,z.number().int().nonnegative().parse(req.body.expectedVersion),req.body);
    const pw=await storage.getProject(id);
    if(pw) await storage.createNotification({recipientId:uid===pw.project.clientId?pw.project.freelancerId:pw.project.clientId,actorId:uid,actorName:'Viewrr',type:'invoice_sent',message:`Estimate v${version.version} for ${pw.project.title} is ready for review.`,link:`/project/${id}`,read:0}).catch(()=>{});
    return version;
  }));
  app.post('/api/projects/:id/estimates/review',requireAuth,route(req=>reviewEstimate(Number(req.params.id),req.auth!.userId,z.number().int().positive().parse(req.body.version),String(req.body.action),String(req.body.feedback??''))));
}
