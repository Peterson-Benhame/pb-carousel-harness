import { invalidArgument } from '../domain/errors.mjs';

const criteria = [
  ['legibility', 'Ler todas as palavras, acentos, símbolos e rótulos nas duas escalas; verificar contraste e densidade.'],
  ['hierarchy', 'Confirmar ordem de leitura, destaque principal e convivência com logo e rodapé.'],
  ['composition', 'Verificar alinhamento, equilíbrio, respiro, intenção e ausência de colisão visual.'],
  ['rhythm', 'Inspecionar relação entre lâminas e emendas, variação coerente e leitura independente.'],
  ['visual-semantics', 'Confirmar que imagens e âncoras explicam a copy sem sugerir relações ou provas inexistentes.'],
  ['brand-finish', 'Conferir tema, fonte, assinatura, logo e acabamento com a identidade aprovada.'],
].map(([id, instruction]) => Object.freeze({ id, required: true, method: 'human-local-assisted@1', instruction }));
const rubric = Object.freeze({
  schemaVersion: 1, id: 'editorial-quality@1', version: 1,
  criteria: Object.freeze(criteria),
  coverage: Object.freeze({ fullResolution: true, mobileWidth: 360, mobileHeight: 450,
    slides: 'every-selected-slide', seams: 'every-selected-seam', panorama: 'final-only-full-and-one-third-with-pan' }),
  results: Object.freeze(['met', 'failed', 'not-verified']),
  blockingFindings: Object.freeze(['clipping', 'illegible-text', 'collision', 'omitted-content', 'wrong-identity']),
  releaseRule: 'All required criteria met, complete pixel coverage, passed objective report and trusted human-local receipt. AI observations never replace that receipt.',
});

/** This immutable checklist supplies instructions only, never a verdict,
 * human identity, confirmation capability, layout release or consent. */
export function getReviewRubric(version) {
  if (version !== 1) throw invalidArgument('Versão de rubrica editorial não suportada.');
  return rubric;
}
