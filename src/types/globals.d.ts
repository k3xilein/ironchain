// Minimal global declarations to allow the project to type-check
// when @types/node is not installed. These are intended as a
// short-term convenience — installing @types/node is recommended.

declare const console: any;
declare const process: {
  env: { [key: string]: string | undefined };
  exit(code?: number): never;
  on: any;
  argv: string[];
  pid: number;
};

declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearTimeout(handle?: any): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearInterval(handle?: any): void;

declare module NodeJS {
  interface Global {
    [key: string]: any;
  }
}

export {};
