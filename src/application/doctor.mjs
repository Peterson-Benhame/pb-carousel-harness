import { loadResourcesManifest,resolveResources,inspectPackage,probeDependency,dependencyNames,diagnostic,DEFAULT_PACKAGE_ROOT } from '../infrastructure/resources.mjs';
import { inspectWorkspace } from './workspace-inspect.mjs';
import { resolveWorkspaceRoot } from '../infrastructure/fs/workspace-paths.mjs';
import { PublicError } from '../domain/errors.mjs';
import { canonicalHash } from '../domain/canonical-json.mjs';

/** Internal diagnostic API. No repair, init, migration, plugin registration, or render execution. */
export async function runDoctor(options={}){
 const {packageRoot=DEFAULT_PACKAGE_ROOT,dependencyProbe=probeDependency,expectedRuntime}=options;
 const diagnostics=[],dependencies={};
 let manifest, packageInfo = null, resources = { fonts: [], diagnostics: [] }, requiredFontIds;
 try {
  manifest = options.manifest ?? await loadResourcesManifest({ packageRoot });
  resources = await resolveResources({ manifest, requiredFontIds: options.requiredFontIds });
  // A requested subset cannot erase mandatory legacy renderer dependencies.
  const legacy = options.rendererId === undefined || options.rendererId === 'legacy-panorama@1';
  requiredFontIds = legacy
   ? [...new Set(['Anton', 'Manrope', 'JetBrains Mono', ...resources.fonts.map(font => font.id)])]
   : resources.fonts.map(font => font.id);
  packageInfo = await inspectPackage({ packageRoot, manifest, rendererId: options.rendererId });
  diagnostics.push(...packageInfo.diagnostics);
 } catch {
  diagnostics.push(diagnostic('PACKAGE_INCOMPLETE', 'package', 'Pacote incompleto ou manifesto de recursos inválido.'));
 }
 for(const name of dependencyNames){
  try{dependencies[name]=await dependencyProbe(name,{packageRoot});}
  catch{dependencies[name]=null;diagnostics.push(diagnostic('DEPENDENCY_UNAVAILABLE',name,'Dependência ausente ou incompatível com o runtime atual.'));}
 }
 let workspace;
 if(dependencies['better-sqlite3'])workspace=await inspectWorkspace(options);
 else {
  workspace={root:null,available:false,schemaVersion:null,settings:null,diagnostics:[]};
  try{workspace.root=resolveWorkspaceRoot(options);}
  catch(error){workspace.diagnostics.push(diagnostic(error instanceof PublicError?error.code:'WORKSPACE_INSPECTION_FAILED','workspace',error instanceof PublicError?error.message:'Não foi possível resolver a raiz do workspace.'));}
 }
 diagnostics.push(...workspace.diagnostics);
 if(manifest&&packageInfo){
  resources=await resolveResources({manifest,fontRoot:options.fontRoot??workspace.settings?.authorizedFontDirectory,requiredFontIds});
  diagnostics.push(...resources.diagnostics);
 }
 const runtime={package:packageInfo?.package??null,node:process.version,platform:process.platform,arch:process.arch,abi:process.versions.modules,napi:process.versions.napi,renderer:packageInfo?.renderer??null,dependencies,fonts:resources.fonts.map(f=>({id:f.id,sha256:f.sha256??null}))};
 if(manifest&&packageInfo){
  const qualified=manifest.qualifiedRuntime;
  if(['node','platform','arch','abi'].some(k=>runtime[k]!==qualified[k])||dependencyNames.some(name=>dependencies[name]&&dependencies[name].version!==qualified.dependencies[name])||dependencies['better-sqlite3']&&dependencies['better-sqlite3'].sqlite!==qualified.native.sqlite||dependencies.sharp&&dependencies.sharp.vips!==qualified.native.vips)diagnostics.push(diagnostic('RUNTIME_INCOMPATIBLE','runtime','Runtime diferente da matriz Windows homologada; consulta compatível permanece disponível.'));
 }
 if(expectedRuntime&&canonicalHash(expectedRuntime)!==canonicalHash(runtime))diagnostics.push(diagnostic('RUNTIME_MISMATCH','runtime','Identidade efetiva não corresponde ao runtime esperado.'));
 // A configured path is not evidence of a working plugin. Real handshake belongs to T29.
 diagnostics.push(diagnostic(options.plugin?'PLUGIN_UNVERIFIED':'PLUGIN_UNCONFIGURED','plugin',options.plugin?'Configuração de plugin fornecida; integração ainda não verificada.':'Plugin não configurado.'));
 const blockers=diagnostics.filter(d=>!d.code.startsWith('PLUGIN_'));
 return {runtime,workspace,resources,diagnostics,readiness:{query:workspace.available,register:workspace.available&&!diagnostics.some(d=>d.code==='RUNTIME_INCOMPATIBLE'||d.code==='PACKAGE_INCOMPLETE'),renderPrerequisites:blockers.length===0,plugin:false},renderBlockers:blockers};
}
