#!/usr/bin/env node

import * as path from "path";
import { globProxyFactory } from "../tools/globProxy";
import { modTsFile } from "../lib/modTsFile";
import { pathDepth } from "../tools/pathDepth";
import { moveContentUpOneLevelFactory } from "../tools/moveContentUpOneLevel"
import { isInsideOrIsDir } from "../tools/isInsideOrIsDir";
import { execFactory } from "../tools/exec";
import { getIsDryRun } from "../lib/getIsDryRun";
import { crawl } from "../tools/crawl";
import * as fs from "fs";
import * as commentJson from "comment-json";



/** 
 * To disable dry run mode  DRY_RUN=1 env variable must be set.
 * This function Change change the working directory.
 * */
async function run(params: { pathToTargetModule: string; }) {

    const { isDryRun } = getIsDryRun();

    const { exec } = execFactory({ isDryRun });
    const { moveContentUpOneLevel } = moveContentUpOneLevelFactory({ isDryRun });


    process.chdir(params.pathToTargetModule);

    if( fs.existsSync(".npmignore") ){
        throw new Error(".npmignore not supported, please use package.json 'files' instead");
    }

    const packageJsonParsed = JSON.parse(
        fs.readFileSync("package.json")
            .toString("utf8")
    );

    const packageJsonFilesResolved: string[] | undefined = await (() => {

        const pathWithWildcards: string[] | undefined =
            packageJsonParsed
                .files
            ;

        if (!pathWithWildcards) {
            return undefined;
        }

        const { globProxy } = globProxyFactory({ "cwdAndRood": "." });


        const flat = [
            (prev: string[], curr: string[]) => [...prev, ...curr], 
            [] as string[]
        ] as const;

        return  Promise.all(
            pathWithWildcards
                .map(pathWithWildcard => globProxy({ pathWithWildcard }))
        ).then(
            arrOfArr => 
                arrOfArr
                    .reduce(...flat)
                    .map(
                        fileOrDirPath => 
                        !fs.lstatSync(fileOrDirPath).isDirectory() ? 
                                [fileOrDirPath]
                                : 
                                crawl(fileOrDirPath)
                                    .map(filePath => path.join(fileOrDirPath, filePath))
                    )
                    .reduce(...flat)
        );


    })();

    const { srcDirPath, denoDistPath, tsconfigOutDir } = fs.existsSync("./mod.ts") ?
        modTsFile.parseMetadata({ "projectPath": "." })
        :
        { // Only so that this script can be used as a standalone ( with module that do not uses denoify )
            "srcDirPath": "./src",
            "denoDistPath": undefined,
            "tsconfigOutDir": commentJson.parse(
                fs.readFileSync("./tsconfig.json")
                    .toString("utf8")
            )["compilerOptions"]["outDir"] as string
        }
        ;


    if (pathDepth(tsconfigOutDir) != 1) {
        throw new Error("tsconfig out dir must be a directory at the root of the project for this script to work");
    }

    if (
        !!packageJsonFilesResolved &&
        packageJsonFilesResolved.find(
            fileOrDirPath => isInsideOrIsDir({
                "dirPath": srcDirPath,
                fileOrDirPath
            })
        )
    ) {

        throw new Error(`Can't include file from ${srcDirPath} in the NPM module`);

    }

    await exec(`rm -r ${srcDirPath}`);

    if (!!denoDistPath) {

        await exec(`rm -r ${denoDistPath}`);

    }

    await moveContentUpOneLevel({ "dirPath": tsconfigOutDir });


    {

        const newPackageJsonRaw = JSON.stringify(
            {
                ...packageJsonParsed,
                ...("main" in packageJsonParsed ? {
                    "main": path.relative(
                        tsconfigOutDir,
                        packageJsonParsed.main
                    )
                } : {}),
                ...("types" in packageJsonParsed ? {
                    "types": path.relative(
                        tsconfigOutDir,
                        packageJsonParsed.types
                    )
                } : {}),
                ...("bin" in packageJsonParsed ? {
                    "bin": (() => {

                        const out: Record<string, string> = {};

                        Object.keys(packageJsonParsed.bin)
                            .map(binName => [binName, packageJsonParsed.bin[binName]] as const)
                            .forEach(([binName, binFilePath]) =>
                                out[binName] = path.relative(
                                    isInsideOrIsDir({
                                        "dirPath": tsconfigOutDir,
                                        "fileOrDirPath": binFilePath
                                    }) ?
                                        tsconfigOutDir : ".",
                                    binFilePath
                                )
                            )
                            ;

                        return out;

                    })()
                } : {}),
                ...(!!packageJsonFilesResolved ? {
                    "files":
                        packageJsonFilesResolved
                            .map(fileOrDirPath =>
                                path.relative(
                                    isInsideOrIsDir({
                                        "dirPath": tsconfigOutDir,
                                        fileOrDirPath
                                    }) ?
                                        tsconfigOutDir : ".", // ./dist : .
                                    fileOrDirPath // ./dist/lib
                                ) // ./lib
                            )
                } : {}),
                "scripts": undefined
            },
            null,
            2
        );

        console.log(`${isDryRun ? "(dry)" : ""} package.json:\n${newPackageJsonRaw}`);

        if (!isDryRun) {

            fs.writeFileSync(
                "package.json",
                Buffer.from(newPackageJsonRaw, "utf8")
            );

        }

    }


}

if (require.main === module) {
    process.once("unhandledRejection", error => { throw error; });
    run({ "pathToTargetModule": "." });
}