import { HttpException, UseGuards } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Throttle } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import { ApiError } from '@zen/api-interfaces';
import bcrypt from 'bcryptjs';
import gql from 'graphql-tag';

import { AuthService, GqlGuard, GqlThrottlerGuard, GqlUser, RequestUser } from '../../auth';
import { ConfigService } from '../../config';
import { JwtService } from '../../jwt';
import { MailService } from '../../mail';
import {
  AccountInfo,
  AuthExchangeTokenInput,
  AuthLoginInput,
  AuthPasswordChangeInput,
  AuthPasswordResetConfirmationInput,
  AuthPasswordResetRequestInput,
  AuthRegisterInput,
  IContext,
} from '../models';

export const typeDefs = gql`
  extend type Query {
    authLogin(data: AuthLoginInput!): AuthSession!
    authExchangeToken(data: AuthExchangeTokenInput): AuthSession!
    authPasswordResetRequest(data: AuthPasswordResetRequestInput!): Boolean
    accountInfo: AccountInfo!
  }

  extend type Mutation {
    authPasswordChange(data: AuthPasswordChangeInput!): Boolean
    authPasswordResetConfirmation(data: AuthPasswordResetConfirmationInput!): AuthSession!
    authRegister(data: AuthRegisterInput!): AuthSession!
  }

  type AuthSession {
    id: Int! # Change to Int! or String! respective to the typeof User['id']
    token: String!
    roles: [String!]!
    rememberMe: Boolean!
    expiresIn: Int!
    rules: [Json!]!
  }

  type GoogleProfile {
    name: String
    given_name: String
    family_name: String
    locale: String
    email: String
    picture: String
  }

  type AccountInfo {
    username: String
    hasPassword: Boolean!
    googleProfile: GoogleProfile
  }

  input AuthLoginInput {
    username: String!
    password: String!
    rememberMe: Boolean!
  }

  input AuthExchangeTokenInput {
    rememberMe: Boolean!
  }

  input AuthPasswordChangeInput {
    oldPassword: String!
    newPassword: String!
  }

  input AuthPasswordResetConfirmationInput {
    newPassword: String!
    token: String!
  }

  input AuthPasswordResetRequestInput {
    emailOrUsername: String!
  }

  input AuthRegisterInput {
    username: String!
    email: String!
    password: String!
  }
`;

@Resolver()
@UseGuards(GqlThrottlerGuard)
@Throttle()
export class AuthResolver {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
    private readonly jwtService: JwtService,
    private readonly mail: MailService
  ) {}

  @Query()
  async authLogin(@Context() ctx: IContext, @Args('data') args: AuthLoginInput) {
    const user = await this.getUserByUsername(args.username, ctx.prisma);

    if (!user) throw new HttpException(ApiError.AuthLogin.USER_NOT_FOUND, 400);

    const correctPassword = await bcrypt.compare(args.password, user.password);
    if (!correctPassword) throw new HttpException(ApiError.AuthLogin.INCORRECT_PASSWORD, 400);

    return this.auth.getAuthSession(user, args.rememberMe);
  }

  @Query()
  @UseGuards(GqlGuard)
  async accountInfo(
    @Context() ctx: IContext,
    @GqlUser() reqUser: RequestUser
  ): Promise<AccountInfo> {
    const user = await ctx.prisma.user.findUnique({
      where: { id: reqUser.id },
    });

    return {
      username: user.username,
      hasPassword: !!user.password,
      googleProfile: user.googleProfile as any,
    };
  }

  @Query()
  @UseGuards(GqlGuard)
  async authExchangeToken(
    @Context() ctx: IContext,
    @GqlUser() reqUser: RequestUser,
    @Args('data') args: AuthExchangeTokenInput
  ) {
    const user = await ctx.prisma.user.findUnique({
      where: { id: reqUser.id },
    });

    if (user) {
      return this.auth.getAuthSession(user, args.rememberMe);
    } else {
      throw new HttpException(ApiError.AuthExchangeToken.USER_NOT_FOUND, 400);
    }
  }

  @Query()
  async authPasswordResetRequest(
    @Context() ctx: IContext,
    @Args('data') args: AuthPasswordResetRequestInput
  ) {
    const possibleUsers = await ctx.prisma.user.findMany({
      where: {
        OR: [
          {
            email: {
              equals: args.emailOrUsername,
              mode: 'insensitive',
            },
          },
          {
            username: {
              equals: args.emailOrUsername,
              mode: 'insensitive',
            },
          },
        ],
        AND: [{ username: { not: null } }],
      },
    });

    if (possibleUsers.length === 0)
      throw new HttpException(ApiError.AuthPasswordResetRequest.USER_NOT_FOUND, 400);

    possibleUsers.forEach(user => this.mail.sendPasswordReset(user));
  }

  @Mutation()
  async authPasswordResetConfirmation(
    @Context() ctx: IContext,
    @Args('data') args: AuthPasswordResetConfirmationInput
  ) {
    let tokenPayload;
    try {
      tokenPayload = this.jwtService.verify(args.token);
    } catch {
      throw new HttpException(ApiError.AuthPasswordResetConfirmation.UNAUTHORIZED, 400);
    }

    let user = await ctx.prisma.user.findUnique({ where: { id: tokenPayload.sub } });

    if (!user) throw new HttpException(ApiError.AuthPasswordResetConfirmation.USER_NOT_FOUND, 400);

    const hashedPassword = await bcrypt.hash(args.newPassword, this.config.bcryptSalt);

    user = await ctx.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return this.auth.getAuthSession(user);
  }

  @Mutation()
  async authRegister(@Context() ctx: IContext, @Args('data') args: AuthRegisterInput) {
    if (!this.config.publicRegistration)
      throw new HttpException(ApiError.AuthRegister.NO_PUBLIC_REGISTRATIONS, 403);

    if (await this.getUserByUsername(args.username, ctx.prisma))
      throw new HttpException(ApiError.AuthRegister.USERNAME_TAKEN, 400);

    if (await this.getUserByEmail(args.email, ctx.prisma))
      throw new HttpException(ApiError.AuthRegister.EMAIL_TAKEN, 400);

    const hashedPassword = await bcrypt.hash(args.password, this.config.bcryptSalt);

    const user = await ctx.prisma.user.create({
      data: {
        username: args.username,
        email: args.email,
        password: hashedPassword,
      },
    });

    if (this.config.production) {
      this.mail.sendGeneral({
        to: user.email,
        subject: 'Sign Up Confirmed',
        context: {
          siteUrl: this.config.siteUrl,
          hiddenPreheaderText: `Sign up confirmed for ${user.username}`,
          header: 'Welcome',
          subHeading: 'Sign Up Confirmed',
          body: `Thank you for signing up ${user.username}!`,
          footerHeader: '',
          footerBody: '',
        },
      });
    }

    return this.auth.getAuthSession(user);
  }

  @Mutation()
  @UseGuards(GqlGuard)
  async authPasswordChange(
    @Context() ctx: IContext,
    @Args('data') args: AuthPasswordChangeInput,
    @GqlUser() reqUser: RequestUser
  ) {
    const user = await ctx.prisma.user.findUnique({ where: { id: reqUser.id } });
    if (!user) throw new HttpException(ApiError.AuthPasswordChange.USER_NOT_FOUND, 400);

    const correctPassword = await bcrypt.compare(args.oldPassword, user.password);
    if (!correctPassword) throw new HttpException(ApiError.AuthPasswordChange.WRONG_PASSWORD, 400);

    const hashedPassword = await bcrypt.hash(args.newPassword, this.config.bcryptSalt);

    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });
  }

  private async getUserByUsername(username: string, prisma: PrismaClient) {
    return prisma.user.findFirst({
      where: {
        username: {
          mode: 'insensitive',
          equals: username,
        },
      },
    });
  }

  private async getUserByEmail(email: string, prisma: PrismaClient) {
    return prisma.user.findFirst({
      where: {
        email: {
          mode: 'insensitive',
          equals: email,
        },
      },
    });
  }
}
