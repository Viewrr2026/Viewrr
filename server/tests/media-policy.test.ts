import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReadMedia, mediaPath } from '../media-policy';
import { checkMediaUrl } from '../services/moderation-service';
test('unpaid client can review a preview but cannot download original',()=>{
  assert.equal(canReadMedia('delivery',false,true,true,false),true);
  assert.equal(canReadMedia('delivery',false,true,false,false),false);
  assert.equal(canReadMedia('delivery',false,true,false,true),true);
});
test('other accounts cannot access even a paid delivery or its preview',()=>{
  for(const preview of [true,false])for(const paid of [true,false])assert.equal(canReadMedia('delivery',false,false,preview,paid),false);
  assert.equal(canReadMedia('delivery',true,false,false,true),false);
  assert.equal(canReadMedia('unknown',false,true,true,true),false);
});
test('freelancer retains original access, public media is shareable',()=>{
  assert.equal(canReadMedia('delivery',true,true,false,false),true);
  for(const scope of ['feed','portfolio','profile'])assert.equal(canReadMedia(scope,false,false,false,false),true);
});
test('durable media references contain no expiring R2 signature; moderation remains narrow',()=>{
  const row={id:42,object_key:'media/11111111-1111-4111-8111-111111111111',mime_type:'video/mp4'};
  const path=mediaPath(row);
  assert.equal(checkMediaUrl(path),null);
  assert.ok(checkMediaUrl('//evil.example/api/media/42/token/original.mp4'));
  assert.ok(checkMediaUrl('/api/media/42/../../evil'));
  assert.ok(checkMediaUrl('javascript:alert(1)'));
  assert.equal(mediaPath(row,true),path.replace('original.','preview.'));
});
