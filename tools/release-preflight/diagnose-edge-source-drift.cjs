'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'tools/production-release/controlled-production-manifest.json'),'utf8'));
const edge=manifest.packageModel.futureIncrementalPromotion.edgeRelease;
const source=path.resolve(root,edge.sourceFile);
if(!source.startsWith(root+path.sep))throw new Error('EDGE_SOURCE_OUTSIDE_REPOSITORY');
const actual=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const result={
  status:actual===edge.sourceSha256?'MATCH':'DRIFT',
  sourceFile:edge.sourceFile,
  approvedSha256:edge.sourceSha256,
  workingSha256:actual,
  productionPromotionApproved:actual===edge.sourceSha256
};
process.stdout.write(JSON.stringify(result,null,2)+'\n');
// Diagnostic only. The canonical promotion readiness verifier must continue
// to reject drift and is never bypassed by this command.
