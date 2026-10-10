import { normalizeSupersetRestContract } from '../../src/lib/fitness/plan-superset-repair';

// الگوی واقعیِ غالب (۱۱۴ گروه فعال): عضو اول صفر، عضو آخر استراحت روی همهٔ ست‌ها
const plan = {
  days: [{
    day: 'شنبه',
    exercises: [
      { name: 'پرس سرشانه', supersetGroup: 'A', supersetType: 'superset', sets: [{ restSec: 90, setNumber: 1 }, { restSec: 90, setNumber: 2 }, { restSec: 90, setNumber: 3 }] },
      { name: 'فیس پول', supersetGroup: 'A', supersetType: 'superset', sets: [{ restSec: 0, setNumber: 1 }, { restSec: 0, setNumber: 2 }, { restSec: 90, setNumber: 3 }] },
      { name: 'اسکوات', sets: [{ restSec: 120 }] },
    ],
  }],
};
const fixed = normalizeSupersetRestContract(plan as any);
const a = plan.days[0].exercises;
console.log('fixed cells:', fixed);
console.log('member1 (اول):', JSON.stringify(a[0].sets.map((s: any) => s.restSec)), '(expect [0,0,0])');
console.log('member2 (آخر):', JSON.stringify(a[1].sets.map((s: any) => s.restSec)), '(expect [90,90,90] — استراحت پس از هر دور)');
console.log('standalone:', JSON.stringify(a[2].sets.map((s: any) => s.restSec)), '(expect [120])');
const pass = JSON.stringify(a[0].sets.map((s: any) => s.restSec)) === '[0,0,0]'
  && JSON.stringify(a[1].sets.map((s: any) => s.restSec)) === '[90,90,90]'
  && JSON.stringify(a[2].sets.map((s: any) => s.restSec)) === '[120]';
console.log(pass ? '✅ PASS' : '❌ FAIL');

// گروه بدون استراحت → دست‌نخورده
const zero = { days: [{ day: 'دو', exercises: [
  { name: 'x', supersetGroup: 'C', sets: [{ restSec: 0 }] },
  { name: 'y', supersetGroup: 'C', sets: [{ restSec: 0 }] },
]}]};
console.log('zero-group fixed:', normalizeSupersetRestContract(zero as any), '(expect 0)');
process.exit(pass ? 0 : 1);
