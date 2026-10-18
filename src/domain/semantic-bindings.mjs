const fail = (code, message) => {
  const error = new TypeError(message);
  error.code = code;
  throw error;
};
const validText = value => typeof value === 'string' && value.trim().length > 0;
const unique = values => new Set(values).size === values.length;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const elementId = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(value);
const sourceFields = new Set(['eyebrow', 'title', 'body', 'code', 'number']);
const representations = new Set(['contextual-image', 'conceptual-illustration', 'visual-metaphor', 'diagram', 'infographic', 'typography-only']);
const elementKinds = new Set(['text', 'subject', 'concept', 'relationship', 'evidence', 'symbol']);
const exactKeys = (value, required) => object(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key));
const boundaries = value => new Set([...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(value)].map(segment => segment.index).concat(value.length));

const validateReferences = (values, ids) => Array.isArray(values) && unique(values)
  && values.every(value => elementId(value) && ids.has(value));

/** Structural intent only. This binds declared semantics to approved copy but
 * does not inspect rendered pixels, authorize a plan or prove visual meaning. */
export function validateSlideSemanticContracts({ version, slides, contracts } = {}) {
  const contractKeys = ['slideIndex', 'centralMessage', 'communicativeObjective', 'representation', 'rationale', 'elements',
    'prohibitions', 'authorizedSubjectElementIds', 'emphasisElementIds', 'constraints', 'approvalCriteria'];
  if (version !== 1 || !Array.isArray(slides) || !Array.isArray(contracts) || contracts.length !== slides.length) {
    fail('SEMANTIC_CONTRACT_INVALID', 'Contrato semântico deve cobrir todas as lâminas.');
  }
  const normalized = structuredClone(contracts).sort((left, right) => left?.slideIndex - right?.slideIndex);
  normalized.forEach((contract, index) => {
    const slide = slides[index];
    if (!exactKeys(contract, contractKeys) || !object(slide) || contract.slideIndex !== slide.index
      || !validText(contract.centralMessage) || !validText(contract.communicativeObjective)
      || !representations.has(contract.representation) || !validText(contract.rationale)
      || !Array.isArray(contract.elements) || !contract.elements.length) {
      fail('SEMANTIC_CONTRACT_INVALID', 'Contrato semântico inválido ou fora da lâmina correspondente.');
    }
    const ids = new Set();
    for (const element of contract.elements) {
      if (!exactKeys(element, ['id', 'kind', 'binding']) || !elementId(element.id) || ids.has(element.id)
        || !elementKinds.has(element.kind) || !exactKeys(element.binding, ['field', 'start', 'end', 'sourceText'])) {
        fail('SEMANTIC_CONTRACT_INVALID', 'Elemento semântico inválido ou duplicado.');
      }
      ids.add(element.id);
      const { field, start, end, sourceText } = element.binding;
      const value = sourceFields.has(field) && Object.hasOwn(slide, field)
        ? (field === 'number' && typeof slide[field] === 'number' ? JSON.stringify(slide[field]) : slide[field]) : null;
      if (typeof value !== 'string' || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= end
        || end > value.length || !boundaries(value).has(start) || !boundaries(value).has(end)
        || !validText(sourceText) || value.slice(start, end) !== sourceText) {
        fail('SEMANTIC_BINDING_MISSING', 'Vínculo semântico não corresponde à copy aprovada.');
      }
    }
    for (const field of ['authorizedSubjectElementIds', 'emphasisElementIds']) {
      if (!validateReferences(contract[field], ids)) fail('SEMANTIC_SYMBOL_UNBOUND', 'Referência semântica sem elemento vinculado.');
    }
    const requiredSubjects = contract.elements.filter(element => element.kind === 'subject').map(element => element.id);
    if (contract.authorizedSubjectElementIds.some(id => contract.elements.find(element => element.id === id)?.kind !== 'subject')
      || requiredSubjects.some(id => !contract.authorizedSubjectElementIds.includes(id))
      || !Array.isArray(contract.prohibitions) || !contract.prohibitions.length
      || contract.prohibitions.some(item => ids.has(item?.id))) {
      fail('SEMANTIC_CONTRACT_CONTRADICTION', 'Classificações semânticas contraditórias ou incompletas.');
    }
    for (const field of ['prohibitions', 'constraints', 'approvalCriteria']) {
      if (!Array.isArray(contract[field]) || !contract[field].length || !contract[field].every(item => exactKeys(item, ['id', 'description']) && elementId(item.id) && validText(item.description))
        || !unique(contract[field].map(item => item.id))) {
        fail('SEMANTIC_CONTRACT_INVALID', 'Restrições e critérios devem ser fechados, descritos e únicos.');
      }
    }
    contract.elements.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    for (const field of ['authorizedSubjectElementIds', 'emphasisElementIds']) contract[field].sort();
    for (const field of ['prohibitions', 'constraints', 'approvalCriteria']) contract[field].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });
  return normalized;
}

export function bindSemanticElements({ text, bindings, elementIds } = {}) {
  if (!validText(text) || !Array.isArray(bindings) || !bindings.length || !Array.isArray(elementIds)) {
    fail('INVALID_ARGUMENT', 'Texto, vínculos e elementos semânticos são obrigatórios.');
  }
  if (!bindings.every(binding => binding && validText(binding.elementId) && /^\[[^\[\]]+\]$/u.test(binding.token ?? ''))
    || !unique(bindings.map(binding => binding.elementId)) || !unique(bindings.map(binding => binding.token)) || !unique(elementIds)) {
    fail('SEMANTIC_BINDING_DUPLICATE', 'Vínculos semânticos devem ser únicos.');
  }

  const boundIds = new Set(bindings.map(binding => binding.elementId));
  if (elementIds.length !== bindings.length || elementIds.some(elementId => !boundIds.has(elementId))) {
    fail('SEMANTIC_SYMBOL_UNBOUND', 'Todo símbolo semântico deve possuir um vínculo com a copy.');
  }

  const resolved = bindings.map(binding => {
    const sourceStart = text.indexOf(binding.token);
    if (sourceStart < 0) fail('SEMANTIC_BINDING_MISSING', `Token ausente: ${binding.token}`);
    if (text.indexOf(binding.token, sourceStart + binding.token.length) >= 0) {
      fail('SEMANTIC_BINDING_DUPLICATE', `Token duplicado: ${binding.token}`);
    }
    return Object.freeze({
      elementId: binding.elementId,
      token: binding.token,
      label: binding.token.slice(1, -1).toLocaleUpperCase('pt-BR'),
      sourceStart,
      sourceEnd: sourceStart + binding.token.length,
      sourceText: binding.token,
    });
  });
  return Object.freeze({ text, bindings: Object.freeze(resolved) });
}
