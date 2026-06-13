import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import BiteshipFulfillmentProviderService from "./service";

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [BiteshipFulfillmentProviderService],
});
