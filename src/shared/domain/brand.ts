declare const brand: unique symbol;

/** Nominal typing: a `UserId` cannot be passed where a `SessionId` is expected. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };
