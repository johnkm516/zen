import { Injectable } from '@angular/core';
import { CanActivate, CanActivateChild, CanLoad, Router } from '@angular/router';
import { Role } from '@zen/api-interfaces';

import { AuthService } from '../auth.service';

export class RolesGuard {
  static has(...roles: Array<keyof typeof Role>) {
    @Injectable({
      providedIn: 'root',
    })
    class HasRoles implements CanActivate, CanActivateChild, CanLoad {
      constructor(private auth: AuthService, private router: Router) {}

      canActivate() {
        return this.auth.userHasRole(roles as string[]) ? true : this.router.parseUrl('/login');
      }

      canActivateChild() {
        return this.canActivate();
      }

      canLoad() {
        return this.canActivate();
      }
    }

    return HasRoles;
  }

  static not(...roles: string[]) {
    @Injectable({
      providedIn: 'root',
    })
    class NotRoles implements CanActivate, CanActivateChild, CanLoad {
      constructor(private auth: AuthService, private router: Router) {}

      canActivate() {
        return this.auth.userNotInRole(roles as string[]) ? true : this.router.parseUrl('/login');
      }

      canActivateChild() {
        return this.canActivate();
      }

      canLoad() {
        return this.canActivate();
      }
    }

    return NotRoles;
  }
}
