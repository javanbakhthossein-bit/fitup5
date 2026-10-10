/**
 * v95 — unit test of the gender-dynamic discipline constants (types.ts).
 * Run: bun scripts/test-disciplines-v95.ts
 */
import {
  DISCIPLINE_LABELS,
  DISCIPLINE_ORDER,
  DISCIPLINES_SHARED,
  DISCIPLINE_DEFAULT,
  sanitizeDiscipline,
  type Discipline,
} from "../src/lib/fitness/types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  OK ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

const kickboxingGone = !("kickboxing" in DISCIPLINE_LABELS);

// 1) kickboxing removed everywhere
check("kickboxing not in DISCIPLINE_LABELS", kickboxingGone);
check("kickboxing not in male list", !DISCIPLINE_ORDER.male.includes("kickboxing" as Discipline));
check("kickboxing not in female list", !DISCIPLINE_ORDER.female.includes("kickboxing" as Discipline));
check("kickboxing not in shared list", !DISCIPLINES_SHARED.includes("kickboxing" as Discipline));

// 2) gender-dynamic sets: female-only disciplines hidden from male and vice versa
const femaleOnly = ["bikini_fitness", "womens_fitness", "wellness", "womens_physique"] as Discipline[];
const maleOnly = ["bodybuilding", "classic_physique", "mens_physique", "powerlifting"] as Discipline[];
for (const d of femaleOnly) {
  check(`male list hides ${d}`, !DISCIPLINE_ORDER.male.includes(d));
  check(`female list shows ${d}`, DISCIPLINE_ORDER.female.includes(d));
}
for (const d of maleOnly) {
  check(`female list hides ${d}`, !DISCIPLINE_ORDER.female.includes(d));
  check(`male list shows ${d}`, DISCIPLINE_ORDER.male.includes(d));
}

// 3) shared disciplines exist in both lists
for (const d of DISCIPLINES_SHARED) {
  check(`shared ${d} in both lists`, DISCIPLINE_ORDER.male.includes(d) && DISCIPLINE_ORDER.female.includes(d));
}

// 4) defaults are inside their gender lists
check("default male in male list", DISCIPLINE_ORDER.male.includes(DISCIPLINE_DEFAULT.male));
check("default female in female list", DISCIPLINE_ORDER.female.includes(DISCIPLINE_DEFAULT.female));

// 5) every list entry has a Persian label (no raw ids in UI)
check("all male entries labeled", DISCIPLINE_ORDER.male.every((d) => !!DISCIPLINE_LABELS[d]));
check("all female entries labeled", DISCIPLINE_ORDER.female.every((d) => !!DISCIPLINE_LABELS[d]));

// 6) lists are duplicate-free and reasonably sized
const uniq = (a: Discipline[]) => new Set(a).size === a.length;
check("male list has no duplicates", uniq(DISCIPLINE_ORDER.male));
check("female list has no duplicates", uniq(DISCIPLINE_ORDER.female));
check("male list size 13", DISCIPLINE_ORDER.male.length === 13, String(DISCIPLINE_ORDER.male.length));
check("female list size 13", DISCIPLINE_ORDER.female.length === 13, String(DISCIPLINE_ORDER.female.length));

// 7) sanitizeDiscipline: legacy/removed values become undefined
check("sanitize kickboxing -> undefined", sanitizeDiscipline("kickboxing") === undefined);
check("sanitize fitness -> fitness", sanitizeDiscipline("fitness") === "fitness");
check("sanitize garbage -> undefined", sanitizeDiscipline("nonsense") === undefined);
check("sanitize null -> undefined", sanitizeDiscipline(null) === undefined);

console.log(`\n${"=".repeat(50)}\nresult: ${pass} OK / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
