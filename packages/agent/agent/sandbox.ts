import { defineSandbox } from "eve/sandbox";
import { microsandbox } from "eve/sandbox/microsandbox";

export default defineSandbox({
  backend: microsandbox(),
});
