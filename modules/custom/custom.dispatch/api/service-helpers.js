export class DispatchServiceError extends Error {
  constructor(message, status = 500, code = 'DISPATCH_ERROR') {
    super(message)
    this.name = 'DispatchServiceError'
    this.status = status
    this.code = code
  }
}

export function isDatabaseConflict(error) {
  return error?.code === 'P2002' || error?.code === '23505'
}
