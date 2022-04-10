module.exports = {
    "env": {
        "browser": true,
        "node": true
    },
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "project": "tsconfig.json",
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint"
    ],
    "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:@typescript-eslint/recommended-requiring-type-checking",
        "prettier"
    ],
    "rules": {
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-floating-promises": "off",
        "@typescript-eslint/restrict-template-expressions": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-unsafe-member-access": "off"
    }
};
