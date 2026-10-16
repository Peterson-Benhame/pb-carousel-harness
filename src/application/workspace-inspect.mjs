import { resolveWorkspaceRoot } from '../infrastructure/fs/workspace-paths.mjs';
import { PublicError } from '../domain/errors.mjs';
import { diagnostic } from '../infrastructure/resources.mjs';

/** Queries only. Loading SQLite/migration resources occurs inside this recoverable boundary. */
export async function inspectWorkspace(options={}){
 let root=null,db;
 try{
  root=resolveWorkspaceRoot(options);
  const {openWorkspace}=await import('../infrastructure/sqlite/database.mjs');
  db=await openWorkspace(root,{readonly:true});
  const settings=db.prepare('SELECT revision,resources_json,authorized_font_directory FROM workspace_settings WHERE singleton=1').get();
  return {root,available:true,schemaVersion:db.pragma('user_version',{simple:true}),settings:settings?{revision:settings.revision,resources:JSON.parse(settings.resources_json),authorizedFontDirectory:settings.authorized_font_directory}:null,diagnostics:[]};
 }catch(error){
  const known=error instanceof PublicError;
  return {root,available:false,schemaVersion:null,settings:null,diagnostics:[diagnostic(known?error.code:'WORKSPACE_INSPECTION_FAILED','workspace',known?error.message:'Não foi possível inspecionar o workspace.') ]};
 }finally{db?.close();}
}
