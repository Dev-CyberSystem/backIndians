/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/__tests__'],
  // Solo archivos *.test.ts / *.spec.ts (evita ejecutar helpers.ts como suite)
  testMatch: ['**/?(*.)+(spec|test).[jt]s?(x)'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs' } }] },
  testTimeout: 30000,
  // Las suites comparten una única DB MySQL (pool max:4). Corriendo en paralelo,
  // varios workers truncan/siembran las mismas tablas y agotan el pool → 500.
  // Forzamos ejecución serial para que los tests sean confiables.
  maxWorkers: 1,
};
