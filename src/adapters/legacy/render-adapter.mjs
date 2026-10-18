import {composeCarousel} from '../../render/composed-carousel.mjs';
import {PublicError} from '../../domain/errors.mjs';

/** In-memory bridge for a prepared Q05 context. No output directory, slug,
 * global brand, source path, unqualified fallback or approval is accepted here.
 * The historical legacy renderer/context remain unchanged and independently
 * readable; new production requires an explicitly derived quality-contract run.
 */
export async function renderPreparedSnapshot(context){
 if(context.snapshot?.contractVersion!==2||context.snapshot.renderer?.id!=='editorial-composed@1'){
  throw new PublicError('RUN_DERIVATION_REQUIRED','Nova produção exige execução derivada no contrato de qualidade.');
 }
 return composeCarousel({carousel:context.carousel,snapshot:context.snapshot,plan:context.plan,
  resources:{fonts:context.fonts,assets:context.assets,logos:context.logos,qualifications:context.resource.qualifications},
  selection:{slideIndices:context.selection.slideIndices,seamPairs:context.selection.seamPairs}});
}
