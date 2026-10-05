/**
 * Smoke check for fleetflow-fully-working-pages.html — run: node fleetflow-check.js
 *
 * Renders every page for every role headlessly and asserts the shipment state
 * machine still refuses illegal transitions. Fails loudly if a template breaks.
 */
const fs = require('fs');
const path = require('path');

/* --- just enough DOM for the render pipeline to run outside a browser --- */
const el = () => ({
  innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
  classList: { add(){}, remove(){}, toggle(){}, contains(){ return false } },
  addEventListener(){}, getContext(){ return {} },
  getBoundingClientRect(){ return {left:0,top:0,width:1,height:1} },
  querySelector(){ return el() }, closest(){ return el() }
});
global.document = { querySelector: () => el(), querySelectorAll: () => [], addEventListener(){} };
global.location = { hash: '' };
global.window = { addEventListener(){} };
global.setInterval = () => 0;
global.setTimeout = () => 0;
global.clearTimeout = () => 0;

const html = fs.readFileSync(path.join(__dirname, 'fleetflow-fully-working-pages.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
// runInThisContext keeps the top-level const/let bindings alive; a plain eval drops them.
require('vm').runInThisContext(scripts + '\n;Object.assign(globalThis,{S,DB,PAGES,FLOW,IDENTITY,shell,ship,can,advance,openWizard,wizardBody,openAssign,renderShipment,renderDriverProfile,renderLogin,renderDriver,driverActive,renderClient,renderTrack});');

let failed = 0;
const ok  = m => console.log('  ok  ' + m);
const bad = m => { failed++; console.log('  X   ' + m); };
const renders = (name, fn) => { try { fn(); } catch (e) { bad(name + ' -> ' + e.message); } };
const assert = (cond, m) => cond ? ok(m) : bad(m);

/* ------------------------------------------------------------- renders */
S.user = IDENTITY.admin;
Object.keys(PAGES).forEach(p => renders('admin/' + p, () => shell(p, PAGES[p]())));
DB.shipments.forEach(s => renders('shipment/' + s.id, () => renderShipment(s.id)));
DB.drivers.forEach(d => renders('driver/' + d.id, () => renderDriverProfile(d.id)));
renders('login', renderLogin);
renders('wizard', () => { openWizard(); for (let i = 0; i < 7; i++) { S.wizard.step = i; wizardBody(); } });
renders('assign modal', () => openAssign('FF-10284'));
renders('404 shipment', () => renderShipment('NOPE'));

S.user = IDENTITY.driver;
['jobs','droute','history','dprofile'].forEach(p => renders('driver/' + p, () => shell(p, renderDriver(p))));
renders('driver/job', () => shell('jobs', renderDriver('job', 'FF-10295')));
renders('driver/job-not-mine', () => shell('jobs', renderDriver('job', 'FF-10288')));
renders('driver/pod', () => shell('jobs', renderDriver('pod', 'FF-10295')));

S.user = IDENTITY.client;
['client','invoices','profile'].forEach(p => renders('client/' + p, () => shell(p, renderClient(p))));

DB.shipments.forEach(s => renders('track/' + s.id, () => renderTrack(s.id)));
renders('track/unknown', () => renderTrack('NOPE'));

/* ------------------------------------------------- state machine guards */
S.user = IDENTITY.admin;
assert(!FLOW.created.includes('delivered'), 'created cannot jump straight to delivered');
assert(advance('FF-10284', 'delivered', 'check') === false, 'illegal transition is rejected');
assert(advance('FF-10288', 'delivered', 'check') === false, 'delivered is rejected without proof of delivery');
ship('FF-10288').pod = { receiver:'T', time:'12:00', gps:'0,0', photo:true, sig:true, notes:'' };
assert(advance('FF-10288', 'delivered', 'check') === true, 'delivered is accepted once POD exists');
assert(ship('FF-10288').payment === 'paid', 'delivery triggers invoicing');

/* --------------------------------------------------------- permissions */
assert(can('admin', 'payments') && !can('dispatcher', 'payments'), 'dispatcher is blocked from billing');
assert(!can('client', 'drivers'), 'client cannot reach fleet pages');

/* ------------------------------------------------------ driver web app */
S.user = IDENTITY.driver;
const windows = driverActive().map(s => s.window);
assert(windows.join() === [...windows].sort().join(), 'driver jobs are ordered by delivery window');
assert(renderDriver('job', 'FF-10288').includes('403'), "driver cannot open another driver's job");
assert(!can('driver', 'payments'), 'driver is blocked from billing');
assert(renderDriver('jobs').includes('class="kpis'), 'driver deliveries page uses the web layout');

console.log(failed ? '\nFAILED: ' + failed : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
