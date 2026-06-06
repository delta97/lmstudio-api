import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setEntryPoint("./remotion/index.ts");
Config.setPublicDir("./remotion/public");
Config.overrideWebpackConfig((config) => config);
