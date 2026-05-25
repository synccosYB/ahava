// Express 5's ParamsDictionary types every param value as `string | string[]`
// to accommodate wildcard splat routes. In this codebase every route uses
// named string params, so we override the Request `params` property to be a
// flat `Record<string, string>`. This is purely a typing convenience.
import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    params: Record<string, string>;
  }
}
