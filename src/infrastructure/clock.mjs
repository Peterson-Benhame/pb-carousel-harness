import {invalidArgument} from '../domain/errors.mjs';

/** Wall-clock epoch milliseconds are shared across processes; timers merely
 * request renewal. A late timer never extends an already expired lease.
 */
export const systemClock=Object.freeze({
 now:()=>Date.now(),
 setInterval:(callback,interval)=>setInterval(callback,interval),
 clearInterval:timer=>clearInterval(timer),
});

export function clockTime(clock=systemClock){
 if(typeof clock?.now!=='function')throw invalidArgument('Relógio inválido.');
 const time=clock.now();
 if(!Number.isSafeInteger(time)||time<0)throw invalidArgument('Relógio inválido.');
 return time;
}

export function clockDeadline(clock,ttlMs){
 const time=clockTime(clock);
 if(!Number.isSafeInteger(ttlMs)||ttlMs<=0||!Number.isSafeInteger(time+ttlMs))throw invalidArgument('Duração de lease inválida.');
 return {time,expiresAt:time+ttlMs};
}
