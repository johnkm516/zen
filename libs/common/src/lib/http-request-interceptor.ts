import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable } from '@angular/core';
import ls from 'localstorage-slim';
import { Observable } from 'rxjs';

import { Environment } from './environment';

@Injectable()
export class HttpRequestInterceptor implements HttpInterceptor {
  apiHost: string;
  gqlHost: string;

  constructor(env: Environment) {
    this.apiHost = new URL(env.url.api).host;
    this.gqlHost = new URL(env.url.graphql).host;
  }

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const token = ls.get('token', { decrypt: true }) as string | undefined;
    const reqHost = new URL(req.url).host;

    if (token && (reqHost === this.apiHost || reqHost === this.gqlHost)) {
      const modifiedReq = req.clone({
        headers: req.headers.set('Authorization', `Bearer ${token}`),
      });

      return next.handle(modifiedReq);
    } else {
      return next.handle(req);
    }
  }
}
