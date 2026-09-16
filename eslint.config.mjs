import { FlatCompat } from "@eslint/eslintrc";
import { fileURLToPath } from "node:url";
import path from "node:path";
const compat = new FlatCompat({ baseDirectory: path.dirname(fileURLToPath(import.meta.url)) });
export default [
  { ignores: [".next/**", "node_modules/**", "mobile/**", "scratch/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript").map((config) => ({
    ...config,
    // Existing style debt stays visible when lint is run without --quiet.
    // Correctness rules (hooks, duplicate JSX props, invalid syntax) still block CI.
    rules: { ...config.rules, "@typescript-eslint/no-explicit-any": "warn", "@typescript-eslint/no-unused-vars": "warn", "@typescript-eslint/no-require-imports": "warn", "react/no-unescaped-entities": "warn", "@next/next/no-html-link-for-pages": "warn" },
  })),
];
