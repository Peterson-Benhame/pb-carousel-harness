import {evaluateRenderedQuality} from '../../quality/objective-checks.mjs';
import {PublicError} from '../../domain/errors.mjs';

/** Validate the exact in-memory T20 output, with real Q06 recomposition. The
 * historical carousel validator and v1 readers retain their original contract.
 * This bridge creates no review, consent, qualification or package. */
export async function validatePreparedSnapshot(context){
 if(context.snapshot?.contractVersion!==2||context.snapshot.renderer?.id!=='editorial-composed@1'){
  throw new PublicError('RUN_DERIVATION_REQUIRED','Nova validação exige execução derivada no contrato de qualidade.');
 }
 if(context.manifest?.kind!=='final')throw new PublicError('VALIDATE_OUTPUT_INVALID','A validação exige o lote final da tentativa exata.');
 return evaluateRenderedQuality({manifest:context.manifest,composition:context.composition,
  files:context.files,qualification:context.resource.qualifications});
}
