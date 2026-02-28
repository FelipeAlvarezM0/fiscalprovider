import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";

import { env } from "../../config/env.js";
import type { FederalRuleset, RulesetMeta, StateRuleset } from "./types.js";

const RULESET_ROOT = path.resolve(process.cwd(), "rulesets");

function readJsonFile<T>(filePath: string): T {
  const absolutePath = path.resolve(RULESET_ROOT, filePath);
  const contents = readFileSync(absolutePath, "utf8");
  return JSON.parse(contents) as T;
}

function signRulesetPayload(payload: object): string {
  return createHmac("sha256", env.RULESET_SIGNING_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");
}

function createRulesetSignatureError(rulesetId: string): Error & { code: string } {
  const error = new Error(`Ruleset signature mismatch for ${rulesetId}`) as Error & { code: string };
  error.code = "RULESET_SIGNATURE_INVALID";
  return error;
}

function verifyRulesetSignature(ruleset: FederalRuleset | StateRuleset): void {
  const { rulesetSignature, ...unsignedPayload } = ruleset;
  const expected = signRulesetPayload(unsignedPayload);

  if (rulesetSignature !== expected) {
    throw createRulesetSignatureError(ruleset.id);
  }
}

export function loadRulesetMeta(): RulesetMeta {
  return readJsonFile<RulesetMeta>("meta.json");
}

export function loadFederalRuleset(version = env.DEFAULT_RULESET_IRS): FederalRuleset {
  const meta = loadRulesetMeta();
  const entry = meta.versions.find((item) => item.id === version);

  if (!entry) {
    throw new Error(`Federal ruleset ${version} not found`);
  }

  const ruleset = readJsonFile<FederalRuleset>(path.relative(RULESET_ROOT, path.resolve(process.cwd(), entry.path)));
  verifyRulesetSignature(ruleset);
  return ruleset;
}

export function loadStateRuleset(version = env.DEFAULT_RULESET_ND): StateRuleset {
  const meta = loadRulesetMeta();
  const entry = meta.versions.find((item) => item.id === version);

  if (!entry) {
    throw new Error(`State ruleset ${version} not found`);
  }

  const ruleset = readJsonFile<StateRuleset>(path.relative(RULESET_ROOT, path.resolve(process.cwd(), entry.path)));
  verifyRulesetSignature(ruleset);
  return ruleset;
}

export function resolveActiveRulesetsForTaxYear(taxYear: number): { federal: string; state: string; localSalesTax: string | null } {
  const meta = loadRulesetMeta();
  const taxYearEntry = meta.activeByTaxYear?.[String(taxYear)];

  return {
    federal: taxYearEntry?.federal ?? meta.active.federal,
    state: taxYearEntry?.state ?? meta.active.state,
    localSalesTax: taxYearEntry?.localSalesTax ?? meta.active.localSalesTax ?? null
  };
}
