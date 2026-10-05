export class ShiyiError extends Error {
  constructor(message, code = 'SHIYI_ERROR', details = undefined) {
    super(message);
    this.name = 'ShiyiError';
    this.code = code;
    if (details !== undefined) this.details = details;
    if (details?.causeError instanceof Error) this.cause = details.causeError;
  }
}

export class ValidationError extends ShiyiError {
  constructor(message, details = undefined) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class ScopeConflictError extends ShiyiError {
  constructor(message = 'operation scope does not match the frozen scope', details = undefined) {
    super(message, 'SCOPE_CONFLICT', details);
    this.name = 'ScopeConflictError';
  }
}

export class RevisionConflictError extends ShiyiError {
  constructor(message = 'expected revision does not match committed revision', details = undefined) {
    super(message, 'REVISION_CONFLICT', details);
    this.name = 'RevisionConflictError';
  }
}

export class PersistenceError extends ShiyiError {
  constructor(message, details = undefined) {
    super(message, 'PERSISTENCE_ERROR', details);
    this.name = 'PersistenceError';
  }
}

export class SummaryResponseError extends ShiyiError {
  constructor(message, details = undefined) {
    super(message, 'SUMMARY_RESPONSE_ERROR', details);
    this.name = 'SummaryResponseError';
  }
}

export class ProbeWriteError extends ShiyiError {
  constructor(message, details = undefined) {
    super(message, 'PROBE_WRITE_FORBIDDEN', details);
    this.name = 'ProbeWriteError';
  }
}
