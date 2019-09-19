import _ from "lodash";
import fs from "fs-extra";
import path from "path";
import { spawn, wait, exec } from "@nebulario/core-process";
import { IO } from "@nebulario/core-plugin-request";
import * as JsonUtils from "@nebulario/core-json";
import * as Cluster from "@nebulario/core-cluster";

export const clear = async (params, cxt) => {
  const {
    performer: {
      type,
      code: {
        paths: {
          absolute: { folder }
        }
      }
    }
  } = params;

  const handlers = {
    onInfo: (info, { file }) => {
      info && IO.sendOutput(info, cxt);
    },
    onRemoved: (info, { file }) => {
      IO.sendOutput(info, cxt);
      IO.sendEvent(
        "warning",
        {
          data: file + " removed..."
        },
        cxt
      );
    },
    onNotFound: ({ file }) => {
      IO.sendEvent(
        "warning",
        {
          data: file + " is not present..."
        },
        cxt
      );
    }
  };

  await Cluster.Control.remove(folder, "stateful.yaml", handlers, cxt);
  await Cluster.Control.remove(folder, "service.yaml", handlers, cxt);
};

export const start = (params, cxt) => {
  const {
    performers,
    performer,
    performer: {
      performerid,
      type,
      code: {
        paths: {
          absolute: { folder }
        }
      },
      dependents,
      module: { dependencies }
    },
    instance: { instanceid }
  } = params;

  const tmpPath = path.join(folder, "tmp");
  const distPath = path.join(folder, "dist");

  const startOp = async (operation, cxt) => {
    IO.sendEvent(
      "out",
      {
        data: "Setting service config..."
      },
      cxt
    );

    const volumeTmpPath = path.join(tmpPath, "volume.yaml");
    fs.writeFileSync(
      volumeTmpPath,
      `
    apiVersion: v1
    kind: PersistentVolume
    metadata:
      name: volume-` +
        instanceid +
        "-" +
        performerid +
        `
    spec:
      storageClassName: local-storage
      accessModes:
        - ReadWriteOnce
      capacity:
        storage: 50Mi
      hostPath:
        path: /data/` +
        instanceid +
        `/` +
        performerid +
        `/
      nodeAffinity:
        required:
          nodeSelectorTerms:
          - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
              - minikube
      `
    );

    const volout = await Cluster.Control.apply(volumeTmpPath, cxt);
    IO.sendOutput(volout, cxt);

    const serviceDevPath = await Cluster.Dev.transform(
      "service.yaml",
      distPath,
      tmpPath,
      async content => {
        content.metadata.namespace =
          instanceid + "-" + content.metadata.namespace;
        return content;
      }
    );

    const srvout = await Cluster.Control.apply(serviceDevPath, cxt);
    IO.sendOutput(srvout, cxt);

    IO.sendEvent(
      "out",
      {
        data: "Setting stateful config..."
      },
      cxt
    );

    const statefulDevPath = await Cluster.Dev.transform(
      "stateful.yaml",
      distPath,
      tmpPath,
      async content => {
        content.metadata.namespace =
          instanceid + "-" + content.metadata.namespace;

        content.spec.volumeClaimTemplates = [
          {
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
          }
        ];

        return content;
      }
    );

    const igosut = await Cluster.Control.apply(statefulDevPath, cxt);
    IO.sendOutput(igosut, cxt);

    IO.sendEvent("done", {}, cxt);

    while (operation.status !== "stopping") {
      await wait(100); //wait(2500);
    }
  };

  return {
    promise: startOp,
    process: null
  };
};

/*
 */
