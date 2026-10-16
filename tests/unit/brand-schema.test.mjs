import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrandConfig } from '../../src/domain/brand-schema.mjs';
import { canonicalHash } from '../../src/domain/canonical-json.mjs';

const config=()=>({name:'Synthetic',profile:'@synthetic',language:'pt-BR',audience:null,voice:null,preferences:[],fonts:{title:'Anton',body:'Manrope',mono:'JetBrains Mono'},themes:{editorial:{background:'#ffffff',text:'#111111',muted:'#555555',accent:'#bb1100',topics:[]}},logo:{enabled:false,variants:{},protection:12,minimumHeight:24},slideWidth:1080,slideHeight:1350,minimumSlideCount:12,maximumSlideCount:16,profileImage:''});
const binding=()=>({background:'background',text:'text',muted:'muted',accent:'accent'});

test('historical brand config is preserved without version, accent, or surface defaults',()=>{
 const input=config(),before=canonicalHash(input),actual=validateBrandConfig(input);
 assert.deepEqual(actual,input);assert.equal(canonicalHash(actual),before);assert.notEqual(actual,input);
 assert.equal(Object.hasOwn(actual,'configVersion'),false);assert.equal(Object.hasOwn(actual.fonts,'accent'),false);
});
test('v2 supports only the optional Nimbus accent and explicit palette-token surface bindings',()=>{
 const input={...config(),configVersion:2};input.fonts.accent='nimbus-roman-italic@1';
 input.themes.editorial.surfaceBindings={light:binding(),dark:{background:'text',text:'background',muted:'background',accent:'accent'}};
 assert.deepEqual(validateBrandConfig(input),input);
 const withoutOptional={...config(),configVersion:2};assert.deepEqual(validateBrandConfig(withoutOptional),withoutOptional);
});
test('v1 does not accept v2 fields, and unsupported config versions remain invalid',()=>{
 const accent=config();accent.fonts.accent='nimbus-roman-italic@1';
 const surfaces=config();surfaces.themes.editorial.surfaceBindings={light:binding()};
 for(const input of [accent,surfaces,...[1,3,'2',null].map(configVersion=>({...config(),configVersion}))])assert.throws(()=>validateBrandConfig(input),{code:'INVALID_ARGUMENT'});
});
test('v2 rejects arbitrary fonts, font paths, executable keys, absent tokens and unlisted surfaces',()=>{
 const v2=()=>({...config(),configVersion:2});
 const variants=[];
 for(const accent of ['Nimbus Roman','Times New Roman','/tmp/NimbusRoman-Italic.otf',{id:'nimbus-roman-italic@1'}]){const c=v2();c.fonts.accent=accent;variants.push(c);}
 for(const surfaceBindings of [{},{sepia:binding()},{light:{...binding(),accent:'secondaryAccent'}},{light:{...binding(),accent:'#bb1100'}},{light:{...binding(),script:'run()'}},{light:{background:'background',text:'text',accent:'accent'}}]){const c=v2();c.themes.editorial.surfaceBindings=surfaceBindings;variants.push(c);}
 for(const c of variants)assert.throws(()=>validateBrandConfig(c),{code:'INVALID_ARGUMENT'});
 const executable=v2();executable.script='process.exit()';assert.throws(()=>validateBrandConfig(executable),{code:'INVALID_ARGUMENT'});
});
test('surface secondary accents refer only to existing tokens in the same theme',()=>{
 const input={...config(),configVersion:2};input.themes.editorial.secondaryAccent='#0000aa';
 input.themes.editorial.surfaceBindings={light:{...binding(),secondaryAccent:'secondaryAccent'}};
 assert.deepEqual(validateBrandConfig(input),input);
 delete input.themes.editorial.secondaryAccent;assert.throws(()=>validateBrandConfig(input),{code:'INVALID_ARGUMENT'});
});
test('brand validation refuses accessors and functions without executing them',()=>{
 let invoked=false;const input={...config(),configVersion:2};Object.defineProperty(input.fonts,'accent',{enumerable:true,get(){invoked=true;return 'nimbus-roman-italic@1';}});
 assert.throws(()=>validateBrandConfig(input),{code:'INVALID_JSON_VALUE'});assert.equal(invoked,false);
 const executable={...config(),configVersion:2};executable.fonts.accent=()=>{};assert.throws(()=>validateBrandConfig(executable),{code:'INVALID_JSON_VALUE'});
});
