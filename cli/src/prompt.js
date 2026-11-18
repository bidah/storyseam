// A numbered picker and a line reader over node:readline. Deliberately not a dependency:
// `npx storyseam` should cold-start on one package, and arrow-key navigation is not worth
// a second install. Every prompt has a default, so --yes and a non-TTY both work.
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const isTTY = () => stdin.isTTY && stdout.isTTY;

async function ask(question, fallback) {
  if (!isTTY()) return fallback;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

export async function input(label, fallback) {
  const suffix = fallback ? ` (${fallback})` : "";
  return ask(`${label}${suffix}: `, fallback);
}

/** choices: [{ value, label, hint }]. Returns a value. */
export async function select(label, choices, fallbackValue) {
  const fallback = fallbackValue ?? choices[0].value;
  if (!isTTY()) return fallback;
  console.log(`\n${label}`);
  choices.forEach((c, i) => {
    const mark = c.value === fallback ? "*" : " ";
    console.log(` ${mark} ${i + 1}. ${c.label}`);
    if (c.hint) console.log(`      ${c.hint}`);
  });
  const raw = await ask(`\nchoose 1-${choices.length} (${choices.findIndex((c) => c.value === fallback) + 1}): `, "");
  const n = Number.parseInt(raw, 10);
  if (Number.isInteger(n) && n >= 1 && n <= choices.length) return choices[n - 1].value;
  return fallback;
}

export async function confirm(label, fallback = true) {
  const answer = await ask(`${label} [${fallback ? "Y/n" : "y/N"}]: `, "");
  if (!answer) return fallback;
  return /^y/i.test(answer);
}
