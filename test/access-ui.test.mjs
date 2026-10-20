import test from 'node:test';
import assert from 'node:assert/strict';
import {renderUserManagement,renderPasswordChange,userRoute,syncAccessOperation} from '../public/access-ui.js';
import {renderSettings} from '../public/admin-ui.js';
import {setLocale} from '../public/i18n.js';
globalThis.document={documentElement:{lang:'ru'}};
const admin={id:'admin',username:'administrator',role:'ADMIN',enabled:true,mustChangePassword:false,updatedAt:'2026-10-19T10:00:00Z'};
const operator={...admin,id:'operator',username:'operator',role:'MIO',mustChangePassword:true};
const settings={version:'one',weights:{R1:35,R2:25,R3:10,R4:15,R5:10,R6:5},dictionary:[]};

test('forced password screen explains the gate and never includes material navigation',()=>{
 setLocale('ru');const html=renderPasswordChange(operator,{forced:true});assert.match(html,/Смените временный пароль/u);assert.match(html,/id="own-password-form"/u);assert.match(html,/autocomplete="current-password"/u);assert.match(html,/name="confirmPassword"/u);assert.match(html,/data-action="logout"/u);assert.doesNotMatch(html,/app-shell|\/api\/bootstrap|href="\/complexes/u);
});
test('normal account screen explains session revocation; demo mode offers setup without a fake account',()=>{
 setLocale('ru');assert.match(renderPasswordChange(admin),/завершатся все ваши сеансы/u);const demo=renderPasswordChange(null);assert.match(demo,/Сначала создайте администратора/u);assert.doesNotMatch(demo,/own-password-form/u);
});
test('first administrator creation differs from employee temporary-password onboarding',()=>{
 setLocale('ru');const first=renderUserManagement([]);assert.match(first,/data-require-password-change="false"/u);assert.match(first,/value="ADMIN"/u);assert.doesNotMatch(first,/value="MIO"/u);
 const existing=renderUserManagement([admin,operator],{selectedId:operator.id,currentUser:admin});assert.match(existing,/data-require-password-change="true"/u);assert.match(existing,/Требуется личный пароль при входе/u);assert.match(existing,/name="expectedUpdatedAt" value="2026-10-19T10:00:00Z"/u);
});
test('last active administrator has explicit guardrails and self-session warning',()=>{
 setLocale('ru');const html=renderUserManagement([admin,operator],{selectedId:admin.id,currentUser:admin});assert.match(html,/последний действующий администратор/u);assert.match(html,/value="MIO" disabled/u);assert.match(html,/value="false" disabled/u);assert.match(html,/прервёт ваш текущий вход/u);
 const enabled=renderUserManagement([admin,{...admin,id:'second'}],{selectedId:admin.id,currentUser:admin});assert.doesNotMatch(enabled,/value="false" disabled/u);
});
test('account templates escape usernames and do not claim an unverified personal password',()=>{
 setLocale('ru');const unsafe={...operator,username:'<script>attack</script>',mustChangePassword:false};const html=renderUserManagement([admin,unsafe],{selectedId:unsafe.id});assert.doesNotMatch(html,/<script>/u);assert.match(html,/&lt;script&gt;attack/u);assert.match(html,/Обязательная смена не назначена/u);assert.doesNotMatch(html,/Личный пароль задан/u);
});
test('operation fields are mutually exclusive and reset credentials are cleared when switching operations',()=>{
 const fields=[{dataset:{accessFields:'UPDATE'}},{dataset:{accessFields:'RESET'}}],password={value:'temporary-secret'};let operation='UPDATE';
 const form={querySelector:selector=>selector.includes('operation')?{value:operation}:password,querySelectorAll:()=>fields};
 syncAccessOperation(form);assert.equal(fields[0].hidden,false);assert.equal(fields[0].disabled,false);assert.equal(fields[1].disabled,true);
 operation='RESET';syncAccessOperation(form,{clearPassword:true});assert.equal(fields[0].disabled,true);assert.equal(fields[1].disabled,false);assert.equal(password.value,'');
 operation='REVOKE';syncAccessOperation(form);assert.ok(fields.every(field=>field.disabled&&field.hidden));
});
test('settings separates account management from scoring and opens initial setup in demo',()=>{
 setLocale('ru');assert.match(renderSettings(settings,[]),/create-user-form/u);assert.doesNotMatch(renderSettings(settings,[]),/id="settings-form"/u);
 assert.match(renderSettings(settings,[admin]),/id="settings-form"/u);assert.doesNotMatch(renderSettings(settings,[admin]),/id="create-user-form"/u);
 assert.match(renderSettings(settings,[admin],{section:'users'}),/id="access-user-form"/u);assert.equal(userRoute('user?one'),'/settings?section=users&user=user%3Fone');
});
test('onboarding, roles and operation labels have Kazakh text while user identifiers remain unchanged',()=>{
 setLocale('kz');try{assert.match(renderPasswordChange(operator,{forced:true}),/Уақытша құпиясөзді өзгертіңіз/u);const html=renderUserManagement([admin,operator],{selectedId:operator.id});assert.match(html,/Тіркелгімен әрекет/u);assert.match(html,/operator/u);assert.doesNotMatch(html,/>Выберите действие</u);}finally{setLocale('ru');}
});
