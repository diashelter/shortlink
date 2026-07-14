import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const PASSWORD_POLICY =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

@ValidatorConstraint({ name: 'MatchRelatedProperty', async: false })
class MatchRelatedPropertyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const [relatedPropertyName] = args.constraints as [string];
    const relatedValue = (args.object as Record<string, unknown>)[
      relatedPropertyName
    ];
    return value === relatedValue;
  }

  defaultMessage(args: ValidationArguments): string {
    const [relatedPropertyName] = args.constraints as [string];
    return `${args.property} must match ${relatedPropertyName}`;
  }
}

function Match(property: string): PropertyDecorator {
  return Validate(MatchRelatedPropertyConstraint, [property]);
}

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(PASSWORD_POLICY, {
    message:
      'password must be at least 8 characters and include upper, lower, digit, and special characters',
  })
  password!: string;

  @IsString()
  @Match('password')
  passwordConfirmation!: string;
}

export class VerifyEmailDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}

export class EmailDto {
  @IsEmail()
  email!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  password!: string;
}

export class VerifyLoginDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @Matches(PASSWORD_POLICY, {
    message:
      'password must be at least 8 characters and include upper, lower, digit, and special characters',
  })
  password!: string;

  @IsString()
  @Match('password')
  passwordConfirmation!: string;
}
