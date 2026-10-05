import {clone,stableStringify,sha256} from './utils.js';
import {personaParts,personaCompositionText} from './persona-composition.js';
import {foldName} from './persona-identity.js';
import {inferPersonaCasting} from './persona-casting.js';

/** Local, reversible source discovery; no model, cursor or original-book write.
 * Explicitly authored/locked dossiers require the owner's decision, not an
 * automatic rewrite under the guise of migration. */
export function rebindPersonaSources(profiles,indexed,{strict=false}={}){
  return profiles.map(profile=>{
    if(profile.deleted||profile.locked||profile.manual||profile.protected||strict)return profile;
    const spans=indexed.spans.filter(s=>s.ownerKey===foldName(profile.name));
    if(!spans.length)return profile;
    const bindings=spans.map(({ownerKey,ref,...s})=>s);
    // Main-card discovery is not semantic acceptance. Adding its untouched
    // baseline to an already evolved dossier can revive the very old attitude
    // it is meant to replace, and changes paid-response `previous` hashes.
    // Only a successfully validated new batch may admit/change/remove card
    // sources. Inspection still exposes the discovered source audit.
    const cardKeys=rows=>[...new Set((rows??[]).filter(b=>b.sourceKind==='character_card').map(b=>stableStringify([b.cardId,b.field,b.book,b.uid,b.id,b.hash,b.stage])))].sort();
    if(stableStringify(cardKeys(profile.bindings))!==stableStringify(cardKeys(bindings)))return profile;
    const fingerprint=sha256(bindings.map(b=>[b.book,b.uid,b.id,b.hash,b.stage]));
    if(profile.sourceBindingFingerprint===fingerprint)return profile;
    const parts=personaParts(spans,profile),old=profile.composition??{};
    const keys=new Set(parts.map(p=>p.key));
    const retiredParts=[...(old.retiredParts??[]),...(old.parts??[]).filter(p=>p.source!=='chat'&&!keys.has(p.key))];
    const composition={...clone(old),version:1,parts,notes:old.notes??profile.text,retiredParts};
    const next={...profile,bindings,composition,casting:inferPersonaCasting(profile.casting,spans),text:personaCompositionText(composition,{hasSources:true}),sourceBindingFingerprint:fingerprint};
    return stableStringify(next)===stableStringify(profile)?profile:next;
  });
}
