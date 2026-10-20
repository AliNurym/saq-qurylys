// Only locally validated messages may be copied into public job diagnostics.
export class SourceValidationError extends Error {
  constructor(message){super(message);this.name='SourceValidationError';this.statusCode=400;}
}
