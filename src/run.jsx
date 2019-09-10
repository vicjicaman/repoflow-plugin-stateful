import _ from 'lodash'
import fs from 'fs-extra'
import path from 'path'
import YAML from 'yamljs';
import {
  spawn,
  wait,
  exec
} from '@nebulario/core-process';
import {
  IO
} from '@nebulario/core-plugin-request';
import * as JsonUtils from '@nebulario/core-json';


const modify = (folder, compFile, func) => {
  const inputPath = path.join(folder, "dist");
  const outputPath = path.join(folder, "tmp");

  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath);
  }

  const srcFile = path.join(inputPath, compFile);
  const destFile = path.join(outputPath, compFile);

  const raw = fs.readFileSync(srcFile, "utf8");
  const content = YAML.parse(raw);
  const mod = func(content);

  fs.writeFileSync(destFile, YAML.stringify(mod, 10, 2).replace("- yes", "- 'yes'"), "utf8");
}


const LocalModify = (inputPath, compFile, func) => {
  const outputPath = path.join(folder, "tmp");

  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath);
  }

  const srcFile = path.join(inputPath, compFile);
  const destFile = path.join(outputPath, compFile);

  const raw = fs.readFileSync(srcFile, "utf8");
  const content = YAML.parse(raw);
  const mod = func(content);

  fs.writeFileSync(destFile, YAML.stringify(mod, 10, 2), "utf8");
}

export const start = (params, cxt) => {

  const {
    performers,
    performer,
    performer: {
      performerid,
      type,
      code: {
        paths: {
          absolute: {
            folder
          }
        }
      },
      dependents,
      module: {
        dependencies
      }
    },
    feature: {
      featureid
    }
  } = params;

  const tmpPath = path.join(folder, "tmp");
  const distPath = path.join(folder, "dist");

  if (!fs.existsSync(tmpPath)) {
    fs.mkdirSync(tmpPath);
  }

  const watcher = async (operation, cxt) => {

    const {
      operationid
    } = operation;

    IO.sendEvent("out", {
      data: "Setting service config..."
    }, cxt);

    const volumeInfo = `
    apiVersion: v1
    kind: PersistentVolume
    metadata:
      name: volume-` + featureid + "-" + performerid + `
    spec:
      storageClassName: local-storage
      accessModes:
        - ReadWriteOnce
      capacity:
        storage: 50Mi
      hostPath:
        path: /data/` + featureid + `/` + performerid + `/
      nodeAffinity:
        required:
          nodeSelectorTerms:
          - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
              - minikube
      `;

    const volumeTmpPath = path.join(tmpPath, "volume.yaml");
    fs.writeFileSync(volumeTmpPath, volumeInfo)
    const volout = await exec(["kubectl apply -f " + volumeTmpPath], {}, {}, cxt);

    IO.sendEvent("out", {
      data: volout.stdout
    }, cxt);

    const servicePath = path.join(distPath, "service.yaml");
    const serviceTmpPath = path.join(tmpPath, "service.yaml");

    modify(folder, "service.yaml", content => {
      content.metadata.namespace = featureid + "-" + content.metadata.namespace;
      return content;
    });

    const nsout = await exec(["kubectl apply -f " + serviceTmpPath], {}, {}, cxt);
    IO.sendOutput(nsout, cxt);

    IO.sendEvent("out", {
      data: "Setting stateful config..."
    }, cxt);

    const statefulPath = path.join(distPath, "stateful.yaml");
    const statefulTmpPath = path.join(tmpPath, "stateful.yaml");

    modify(folder, "stateful.yaml", content => {
      content.metadata.namespace = featureid + "-" + content.metadata.namespace;

      content.spec.volumeClaimTemplates = [{
        metadata: {
          name: content.spec.volumeClaimTemplates[0].metadata.name
        },
        spec: {
          accessModes: ["ReadWriteOnce"],
          storageClassName: "local-storage",
          resources: {
            requests: {
              storage: "50Mi"
            }
          }
        }
      }];

      for (const depSrv of dependents) {
        const depSrvPerformer = _.find(performers, {
          performerid: depSrv.moduleid
        });

        if (depSrvPerformer) {
          IO.sendEvent("out", {
            data: "Performing dependent found " + depSrv.moduleid
          }, cxt);

          if (depSrvPerformer.linked.includes("run")) {

            IO.sendEvent("info", {
              data: " - Linked " + depSrv.moduleid
            }, cxt);

            const serviceLabel = _.find(depSrvPerformer.labels, lbl => lbl.startsWith("service:"));

            if (serviceLabel) {
              const service = serviceLabel.split(":")[1];
              IO.sendEvent("out", {
                data: " - Service container " + service
              }, cxt);


              const currCont = _.find(content.spec.template.spec.containers, ({
                name
              }) => name === service);

              if (currCont) {
                const [imgName, imgVer] = currCont.image.split(":");
                currCont.image = imgName + ":linked";
              }

            } else {
              IO.sendEvent("warning", {
                data: " - No service label"
              }, cxt);
            }
          } else {
            IO.sendEvent("warning", {
              data: " - Not linked " + depSrv.moduleid
            }, cxt);
          }


        }

      }

      return content;
    });


    let found = true;
    try {
      const deligosut = await exec(["kubectl get -f " + statefulTmpPath], {}, {}, cxt);
      IO.sendOutput(deligosut, cxt);
    } catch (e) {
      found = false;
      IO.sendEvent("warning", {
        data: "Stateful set is not present..."
      }, cxt);
    }

    if (found) {
      const deligosut = await exec(["kubectl delete -f " + statefulTmpPath], {}, {}, cxt);
      IO.sendOutput(deligosut, cxt);
    }



    await wait(2500);

    const igosut = await exec(["kubectl apply -f " + statefulTmpPath], {}, {}, cxt);
    IO.sendOutput(igosut, cxt);

    const serviceContent = JsonUtils.load(serviceTmpPath, true);

    while (operation.status !== "stopping") {

      await wait(2500);
    }

    IO.sendEvent("stopped", {
      operationid,
      data: "Stopping service config..."
    }, cxt);
  }


  return {
    promise: watcher,
    process: null
  };
}
