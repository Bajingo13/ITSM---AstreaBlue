export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-duplicate-imports": "error",
      "no-dupe-else-if": "error",
      "no-unreachable": "error",
      "no-unreachable-loop": "error",
      "no-useless-catch": "error",
    },
  },
];
