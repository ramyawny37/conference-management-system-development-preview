'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {generateKeyPairSync,createHash,sign,randomBytes}=require('node:crypto');

test('the Edge WebAuthn verifier accepts a valid synced assertion and rejects signature or UV failures',async()=>{
  const {verifyAuthenticationResponse}=await import('@simplewebauthn/server');
  const {isoCBOR,isoBase64URL}=await import('@simplewebauthn/server/helpers');
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const jwk=publicKey.export({format:'jwk'});
  const publicKeyCose=isoCBOR.encode(new Map([
    [1,2],[3,-7],[-1,1],[-2,isoBase64URL.toBuffer(jwk.x)],[-3,isoBase64URL.toBuffer(jwk.y)],
  ]));
  const challenge=isoBase64URL.fromBuffer(randomBytes(32));
  const origin='https://ramyawny37.github.io',rpID='ramyawny37.github.io';
  const credentialID=isoBase64URL.fromBuffer(randomBytes(32));
  const clientData=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin,crossOrigin:false}));

  function assertion(flags,tamperSignature=false){
    const authenticatorData=Buffer.alloc(37);
    createHash('sha256').update(rpID).digest().copy(authenticatorData);
    authenticatorData[32]=flags;
    authenticatorData.writeUInt32BE(1,33);
    const signedData=Buffer.concat([
      authenticatorData,createHash('sha256').update(clientData).digest(),
    ]);
    const signature=sign('sha256',signedData,privateKey);
    if(tamperSignature)signature[signature.length-1]^=1;
    return {
      id:credentialID,rawId:credentialID,type:'public-key',clientExtensionResults:{},
      authenticatorAttachment:'platform',response:{
        clientDataJSON:isoBase64URL.fromBuffer(clientData),
        authenticatorData:isoBase64URL.fromBuffer(authenticatorData),
        signature:isoBase64URL.fromBuffer(signature),userHandle:null,
      },
    };
  }
  const verify=response=>verifyAuthenticationResponse({response,expectedChallenge:challenge,
    expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,
    credential:{id:credentialID,publicKey:publicKeyCose,counter:0,transports:['internal']}});

  // UP + UV + BE + BS describes a user-verified, backed-up multi-device credential.
  const valid=await verify(assertion(0x1d));
  assert.equal(valid.verified,true);
  assert.equal(valid.authenticationInfo.userVerified,true);
  assert.equal(valid.authenticationInfo.credentialDeviceType,'multiDevice');
  assert.equal(valid.authenticationInfo.credentialBackedUp,true);

  const invalidSignature=await verify(assertion(0x1d,true));
  assert.equal(invalidSignature.verified,false);
  await assert.rejects(()=>verify(assertion(0x19)),/User verification required/);
});
