import _ from 'lodash'
import fs from 'fs-extra'
import path from 'path'
import YAML from 'yamljs';
import {
  exec,
  spawn,
  wait
} from '@nebulario/core-process';
import {
  Operation,
  IO,
  Watcher
} from '@nebulario/core-plugin-request';

import * as Config from '@nebulario/core-config';
import * as JsonUtils from '@nebulario/core-json'



export const clear = async (params, cxt) => {

  const {
    performer: {
      type,
      code: {
        paths: {
          absolute: {
            folder
          }
        }
      }
    }
  } = params;

  if (type !== "instanced") {
    throw new Error("PERFORMER_NOT_INSTANCED");
  }

  try {
    await Config.clear(folder);
  } catch (e) {
    IO.sendEvent("error", {
      data: e.toString()
    }, cxt);
    throw e;
  }

  return "Configuration cleared";
}



export const init = async (params, cxt) => {

  const {
    performer: {
      type,
      code: {
        paths: {
          absolute: {
            folder
          }
        }
      }
    }
  } = params;

  if (type !== "instanced") {
    throw new Error("PERFORMER_NOT_INSTANCED");
  }

  try {
    await Config.init(folder);
  } catch (e) {
    IO.sendEvent("error", {
      data: e.toString()
    }, cxt);
    throw e;
  }

  return "Config service initialized";
}

export const start = (params, cxt) => {

  const {
    performer: {
      type,
      code: {
        paths: {
          absolute: {
            folder
          }
        }
      }
    }
  } = params;

  if (type !== "instanced") {
    throw new Error("PERFORMER_NOT_INSTANCED");
  }


  const configPath = path.join(folder, "config.json");
  const servicePath = path.join(folder, "service.yaml");
  const statefulPath = path.join(folder, "stateful.yaml");


  const watcher = async (operation, cxt) => {

    const {
      operationid
    } = operation;

    IO.sendEvent("out", {
      operationid,
      data: "Watching config changes for " + configPath
    }, cxt);

    await build(operation, params, cxt);

    const watcherConfig = Watcher.watch(configPath, () => {
      IO.sendEvent("out", {
        operationid,
        data: "config.json changed..."
      }, cxt);
      build(operation, params, cxt);
    });
    const watcherService = Watcher.watch(servicePath, () => {
      IO.sendEvent("out", {
        operationid,
        data: "service.yaml changed..."
      }, cxt);
      build(operation, params, cxt);
    });
    const watcherStateful = Watcher.watch(statefulPath, () => {
      IO.sendEvent("out", {
        operationid,
        data: "stateful.yaml changed..."
      }, cxt);
      build(operation, params, cxt);
    });


    while (operation.status !== "stopping") {
      await wait(2500);
    }

    watcherConfig.close();
    watcherStateful.close();
    watcherService.close();
    await wait(100);

    IO.sendEvent("stopped", {
      operationid,
      data: ""
    }, cxt);
  }


  return {
    promise: watcher,
    process: null
  };
}




const build = (operation, params, cxt) => {

  const {
    performer: {
      type,
      code: {
        paths: {
          absolute: {
            folder
          }
        }
      }
    }
  } = params;

  const {
    operationid
  } = operation;

  try {

    IO.sendEvent("out", {
      operationid,
      data: "Start building config..."
    }, cxt);

    Config.build(folder);

    IO.sendEvent("done", {
      operationid,
      data: "Config generated: dist/config.json"
    }, cxt);


    const config = JsonUtils.load(path.join(folder, "config.json"));
    const values = Config.values(folder, config);

    const filesToCopy = ["stateful.yaml", "service.yaml"];
    const outputPath = path.join(folder, "dist");

    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath);
    }

    for (const compFile of filesToCopy) {
      const srcFile = path.join(folder, compFile);
      const destFile = path.join(outputPath, compFile);

      const raw = fs.readFileSync(srcFile, "utf8");
      const convert = Config.replace(raw, values);
      fs.writeFileSync(destFile, convert, "utf8");
    }


    IO.sendEvent("done", {
      operationid,
      data: JSON.stringify(values, null, 2)
    }, cxt);


  } catch (e) {
    IO.sendEvent("error", {
      operationid,
      data: e.toString()
    }, cxt);
  }

}
