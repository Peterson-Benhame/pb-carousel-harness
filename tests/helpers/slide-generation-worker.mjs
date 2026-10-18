import { openWorkspace } from '../../src/infrastructure/sqlite/database.mjs';
import { createSlideGenerationLedger } from '../../src/application/slide-generation-ledger.mjs';

const [root,packageRoot]=process.argv.slice(2),db=await openWorkspace(root,{readonly:false});
const ledger=await createSlideGenerationLedger({root,db,packageRoot});
process.send('ready');
process.once('message',async request=>{
 try { process.send({ok:true,value:await ledger.reserveAutomatic(request)}); }
 catch(error) { process.send({ok:false,code:error.code??'UNEXPECTED_ERROR',message:error.message}); }
 finally { db.close();process.disconnect(); }
});
