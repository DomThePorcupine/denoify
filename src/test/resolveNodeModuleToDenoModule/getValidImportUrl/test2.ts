
import { ModuleAddress } from "../../../lib/types/ModuleAddress";
import { getValidImportUrlFactory } from "../../../lib/resolveNodeModuleToDenoModule";

import { assert } from "evt/tools/typeSafety";

(async () => {

    const moduleAddress: ModuleAddress.GitHubRepo = {
        "type": "GITHUB REPO",
        "userOrOrg": "garronej",
        "repositoryName": "ts-md5",
        "branch": undefined
    } as const;

    const getValidImportUrlFactoryResult = await getValidImportUrlFactory({
        "moduleAddress": moduleAddress,
        "desc": "MATCH VERSION INSTALLED IN NODE_MODULE",
        "version": "99.99.99"
    });

    assert(getValidImportUrlFactoryResult.couldConnect === true);

    const { versionFallbackWarning, isDenoified, getValidImportUrl } = getValidImportUrlFactoryResult;

    assert((
        isDenoified === true &&
        typeof versionFallbackWarning === "string"
    ));

    assert(
        await getValidImportUrl({ "target": "DEFAULT EXPORT" })
        ===
        "https://raw.githubusercontent.com/garronej/ts-md5/master/mod.ts"
    );

    assert(
        await getValidImportUrl({ "target": "SPECIFIC FILE", "specificImportPath": "dist/parallel_hasher" })
        ===
        "https://raw.githubusercontent.com/garronej/ts-md5/master/deno_dist/parallel_hasher.ts"
    );


    assert(
        await getValidImportUrl({ "target": "SPECIFIC FILE", "specificImportPath": "./dist/parallel_hasher" })
        ===
        "https://raw.githubusercontent.com/garronej/ts-md5/master/deno_dist/parallel_hasher.ts"
    );

    console.log("PASS");


})();
