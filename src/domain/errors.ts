/** An error caused by invalid input or a forbidden action. Safe to show to the user. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}
