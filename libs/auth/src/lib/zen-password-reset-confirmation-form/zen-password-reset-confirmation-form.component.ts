import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
} from '@angular/core';
import { FormControl, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AuthPasswordResetConfirmation,
  AuthPasswordResetConfirmationGQL,
  AuthPasswordResetConfirmationInput,
  parseGqlErrors,
} from '@zen/graphql';
import { Subscription } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { verticalAccordion } from '../animations';
import { AuthService } from '../auth.service';
import { passwordValidatorFn } from '../validators';

interface FormType {
  password: FormControl<AuthPasswordResetConfirmationInput['newPassword']>;
  passwordConfirm: FormControl<AuthPasswordResetConfirmationInput['newPassword']>;
}

@Component({
  selector: 'zen-password-reset-confirmation-form',
  templateUrl: 'zen-password-reset-confirmation-form.component.html',
  animations: [...verticalAccordion],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZenPasswordResetConfirmationFormComponent implements AfterViewInit, OnDestroy {
  @ViewChild('passwordInput') passwordInput!: ElementRef<HTMLInputElement>;
  @Output() confirmed = new EventEmitter();
  @Input() redirectTime = 5; //default 5 seconds

  #subs: Subscription[] = [];
  loading = false;
  completed = false;
  generalError = false;
  token: string | null = null;
  hidePassword = true;
  form = new FormGroup<FormType>({
    password: new FormControl('', {
      validators: [Validators.required, this.passwordValidator()],
      nonNullable: true,
    }),
    passwordConfirm: new FormControl('', {
      validators: [Validators.required, this.passwordConfirmValidator()],
      nonNullable: true,
    }),
  });

  constructor(
    private authPasswordResetConfirmationGQL: AuthPasswordResetConfirmationGQL,
    private route: ActivatedRoute,
    public router: Router,
    private auth: AuthService
  ) {
    const sub = this.route.queryParamMap
      .pipe(map(params => params.get('token')))
      .subscribe(token => (this.token = token));
    this.#subs.push(sub);
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.passwordInput.nativeElement.select();
    });
  }

  get password() {
    return this.form.get('password') as FormType['password'];
  }

  get passwordConfirm() {
    return this.form.get('passwordConfirm') as FormType['passwordConfirm'];
  }

  passwordValidator(): ValidatorFn {
    return control => {
      if (this.form) {
        this.passwordConfirm.updateValueAndValidity();
        return passwordValidatorFn(control);
      }
      return null;
    };
  }

  passwordConfirmValidator(): ValidatorFn {
    return control => {
      if (this.form) {
        const notMatching = control.value && this.password.value !== control.value;
        return notMatching ? { notMatching: true } : null;
      }
      return null;
    };
  }

  onSubmit() {
    if (!this.loading) {
      this.loading = true;
      this.generalError = false;

      this.authPasswordResetConfirmationGQL
        .mutate(
          {
            data: {
              newPassword: this.password.value,
              token: this.token as string,
            },
          },
          { fetchPolicy: 'no-cache' }
        )
        .pipe(catchError(parseGqlErrors))
        .subscribe({
          next: ({ data }) => {
            this.loading = false;
            this.completed = true;
            this.auth.setSession(
              (<AuthPasswordResetConfirmation>data).authPasswordResetConfirmation
            );

            setTimeout(() => {
              this.router.navigateByUrl('/');
              this.confirmed.emit();
            }, this.redirectTime * 1000);
          },
          error: () => {
            this.loading = false;
            this.generalError = true;
            this.form.enable();
          },
        });

      this.form.disable();
    }
  }

  ngOnDestroy() {
    this.#subs.forEach(s => s.unsubscribe());
  }
}
