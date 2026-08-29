export type DeviceErrorCode =
  | 'DEVICE_INSTALLATION_ID_REQUIRED'
  | 'DEVICE_INSTALLATION_ID_INVALID'
  | 'DEVICE_NOT_AUTHORIZED'
  | 'DEVICE_CHANGE_REQUIRED'
  | 'DEVICE_CHANGE_ALREADY_PENDING'
  | 'DEVICE_CHANGE_REQUEST_NOT_FOUND'
  | 'DEVICE_CHANGE_REQUEST_ALREADY_RESOLVED'
  | 'STUDENT_REQUIRED'
  | 'PLATFORM_ADMIN_REQUIRED'
  | 'ACCOUNT_INACTIVE';

export class DeviceError extends Error {
  constructor(
    readonly code: DeviceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceError';
  }
}

export class DeviceInstallationIdRequiredError extends DeviceError {
  constructor() {
    super('DEVICE_INSTALLATION_ID_REQUIRED', 'Device installation ID is required.');
    this.name = 'DeviceInstallationIdRequiredError';
  }
}

export class DeviceInstallationIdInvalidError extends DeviceError {
  constructor() {
    super('DEVICE_INSTALLATION_ID_INVALID', 'Device installation ID is invalid.');
    this.name = 'DeviceInstallationIdInvalidError';
  }
}

export class DeviceNotAuthorizedError extends DeviceError {
  constructor() {
    super('DEVICE_NOT_AUTHORIZED', 'Device is not authorized.');
    this.name = 'DeviceNotAuthorizedError';
  }
}

export class DeviceChangeRequiredError extends DeviceError {
  constructor() {
    super('DEVICE_CHANGE_REQUIRED', 'Device change is required.');
    this.name = 'DeviceChangeRequiredError';
  }
}

export class DeviceChangeAlreadyPendingError extends DeviceError {
  constructor() {
    super('DEVICE_CHANGE_ALREADY_PENDING', 'Device change request is already pending.');
    this.name = 'DeviceChangeAlreadyPendingError';
  }
}

export class DeviceChangeRequestNotFoundError extends DeviceError {
  constructor() {
    super('DEVICE_CHANGE_REQUEST_NOT_FOUND', 'Device change request was not found.');
    this.name = 'DeviceChangeRequestNotFoundError';
  }
}

export class DeviceChangeRequestAlreadyResolvedError extends DeviceError {
  constructor() {
    super('DEVICE_CHANGE_REQUEST_ALREADY_RESOLVED', 'Device change request is already resolved.');
    this.name = 'DeviceChangeRequestAlreadyResolvedError';
  }
}

export class StudentRequiredError extends DeviceError {
  constructor() {
    super('STUDENT_REQUIRED', 'Student account is required.');
    this.name = 'StudentRequiredError';
  }
}

export class PlatformAdminRequiredError extends DeviceError {
  constructor() {
    super('PLATFORM_ADMIN_REQUIRED', 'Platform Admin account is required.');
    this.name = 'PlatformAdminRequiredError';
  }
}

export class DeviceAccountInactiveError extends DeviceError {
  constructor() {
    super('ACCOUNT_INACTIVE', 'Account is not active.');
    this.name = 'DeviceAccountInactiveError';
  }
}
