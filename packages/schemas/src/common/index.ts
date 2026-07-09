/**
 * Public barrel for OASP's shared sub-schemas. Resource schemas import
 * from these files directly; other packages should import from here
 * (or from the package root) rather than reaching into `common/*`.
 */
export { providerSchema, type Provider } from './provider';
export { scopeSchema, type Scope } from './scope';
export { principalKindSchema, type PrincipalKind } from './principal-kind';
export { principalRefSchema, type PrincipalRef } from './principal-ref';
export { agentVersionRefSchema, type AgentVersionRef } from './agent-version-ref';
