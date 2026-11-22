import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next 15 ships the older config format; FlatCompat adapts it to ESLint 9's flat config.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", ".claude/**", "public/sw.js"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // The only images are the app's own small SVG icon; next/image would add nothing.
  { rules: { "@next/next/no-img-element": "off" } },
];

export default config;
