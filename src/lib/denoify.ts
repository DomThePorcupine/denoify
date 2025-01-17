
import { denoifySingleFileFactory } from "./denoifySingleFile";
import { transformCodebase } from "../tools/transformCodebase";
import { resolveNodeModuleToDenoModuleFactory } from "./resolveNodeModuleToDenoModule";
import * as fs from "fs";
import * as path from "path";
import * as commentJson from "comment-json";
import { denoifyImportExportStatementFactory } from "./denoifyImportExportStatement";
import { isInsideOrIsDir } from "../tools/isInsideOrIsDir";
import { getInstalledVersionPackageJsonFactory } from "./getInstalledVersionPackageJson";
import { toPosix } from "../tools/toPosix"
import { id } from "tsafe";
import { resolvePathsWithWildcards } from "../tools/resolvePathsWithWildcards";
import { arrPartition } from "evt/tools/reducers/partition";
import { fsCopy } from "../tools/fsCopy";


export async function denoify(
    params: {
        projectPath: string;
        srcDirPath: string | undefined;
        denoDistPath: string | undefined;
        indexFilePath: string | undefined;
    }
) {

    process.chdir(params.projectPath ?? ".");

    const srcDirPath = !!params.srcDirPath ?
        params.srcDirPath :
        ["src", "lib"].find(sourceDirPath => fs.existsSync(sourceDirPath))
        ;

    console.log(`Denoify is reading sources files from ${srcDirPath}`);

    if (!srcDirPath) {
        throw new Error("No src directory found");
    }

    const packageJsonParsed = JSON.parse(
        fs.readFileSync("package.json")
            .toString("utf8")
    );

    const denoifyParamsFromPackageJson: {
        replacer?: string;
        ports?: { [portName: string]: string; }
        includes?: (string | { src: string; destDir?: string; destBasename?: string; })[];
        out?: string;
        index?: string;
    } = packageJsonParsed["denoify"] ?? {};

    {

        const { includes, ports, replacer } = denoifyParamsFromPackageJson;

        if (
            (
            includes !== undefined &&
            !includes.every(pathOrObj =>
                typeof pathOrObj === "string" || (
                    pathOrObj instanceof Object &&
                    typeof pathOrObj.src === "string" &&
                    (pathOrObj.destDir === undefined || typeof pathOrObj.destDir === "string") &&
                    (pathOrObj.destBasename === undefined || typeof pathOrObj.destBasename === "string")
                )
            )
            ) || (
                ports !== undefined &&
                !(
                    ports instanceof Object &&
                    Object.keys(ports).every(key => typeof ports![key] === "string")
                )
            ) || (
                replacer !== undefined &&
                typeof replacer !== "string"
            )
        ) {

            console.log([
                "Denoify configuration Error",
                "The \"denoify\" in the package.json is malformed",
                "See: https://github.com/garronej/my_dummy_npm_and_deno_module"
            ].join("\n"));

            process.exit(-1);

        }

    }

    const tsconfigOutDir = getTsConfigOutDir();
    let denoDistPath: string;
    if (params.denoDistPath !== undefined) {
        denoDistPath = params.denoDistPath
    } else if (typeof denoifyParamsFromPackageJson.out === "string") {
        denoDistPath = denoifyParamsFromPackageJson.out;
    } else if (tsconfigOutDir != null) {
        denoDistPath = path.join(
            path.dirname(tsconfigOutDir),
            `deno_${path.basename(tsconfigOutDir)}`
        );
    } else {
        throw new Error(`You should specify output directory by --out option or specify "outDir" in tsconfig.json`);
    }

    console.log(`Deno distribution will be generated at ${denoDistPath}`);

    const { denoifySingleFile } = denoifySingleFileFactory((() => {

        const { getInstalledVersionPackageJson } = getInstalledVersionPackageJsonFactory({
            "projectPath": "."
        });

        const { denoifyImportExportStatement } = denoifyImportExportStatementFactory((() => {

            const { resolveNodeModuleToDenoModule } = resolveNodeModuleToDenoModuleFactory({
                "userProvidedPorts": denoifyParamsFromPackageJson.ports ?? {},
                "dependencies": packageJsonParsed["dependencies"] ?? {},
                "devDependencies": packageJsonParsed["devDependencies"] ?? {},
                "log": console.log,
                getInstalledVersionPackageJson
            });

            return id<Parameters<typeof denoifyImportExportStatementFactory>[0]>({
                "getDestDirPath": ({ dirPath }) =>
                    path.join(
                        denoDistPath,
                        path.relative(srcDirPath, dirPath)
                    ),
                resolveNodeModuleToDenoModule,
                "userProvidedReplacerPath": denoifyParamsFromPackageJson.replacer,
                getInstalledVersionPackageJson
            });


        })());

        return { denoifyImportExportStatement };

    })());


    await transformCodebase({
        srcDirPath,
        "destDirPath": denoDistPath,
        "transformSourceCodeString": async ({ sourceCode, filePath }) => {

            if (/\.deno\.tsx?$/i.test(filePath)) {

                const nodeFilePath = filePath.replace(/\.deno\.ts/i, ".ts");

                if (fs.existsSync(nodeFilePath)) {
                    return undefined;
                }

                return {
                    "modifiedSourceCode": sourceCode,
                    "newFileName": path.basename(nodeFilePath)
                };

            }

            if (!/\.(?:ts|tsx|js|jsx)$/i.test(filePath)) {
                return { "modifiedSourceCode": sourceCode };
            }

            const denoVersionFilePath = (() => {

                const split = filePath.split(".");

                split.splice(split.length - 1, 0, "deno");

                return split.join(".");

            })();

            if (fs.existsSync(denoVersionFilePath)) {

                return {
                    "modifiedSourceCode": fs.readFileSync(denoVersionFilePath)
                        .toString("utf8")
                };

            }

            if (/^\s*\/\/\s*@denoify-ignore/.test(sourceCode)) {
                return undefined;
            }

            return {
                "modifiedSourceCode": await denoifySingleFile({
                    sourceCode,
                    "dirPath": path.dirname(filePath)
                })
            };


        }
    });

    generateModFile({ 
        packageJsonParsed, 
        tsconfigOutDir, 
        denoDistPath, 
        srcDirPath,
        "explicitlyProvidedIndexFilePath": 
            params.indexFilePath ?? denoifyParamsFromPackageJson.index
    });

    {

        const includes = (denoifyParamsFromPackageJson.includes ?? ["README.md", "LICENSE"])
            .map(
                pathOrObj => typeof pathOrObj === "string" ?
                    path.normalize(pathOrObj) :
                    ({
                        ...pathOrObj,
                        "src": path.normalize(pathOrObj.src)
                    })
            );


        const [strIncludes, objIncludes] = arrPartition(
            includes,
            (include): include is string => typeof include === "string"
        );



        (await resolvePathsWithWildcards({
            "pathWithWildcards": strIncludes
        }))
            .forEach(
                resolvedPath =>
                    fsCopy(
                        resolvedPath,
                        path.join(
                            denoDistPath,
                            resolvedPath
                        )
                    )
            );

        objIncludes
            .forEach(({ src, destDir, destBasename }) =>
                fsCopy(
                    src,
                    path.join(
                        denoDistPath,
                        path.join(
                            destDir ?? path.dirname(src),
                            destBasename ?? path.basename(src)
                        )
                    )
                )
            );

    }


}

function getTsConfigOutDir(): string | undefined {
    const parsedTsCompile = commentJson.parse(
        fs.readFileSync("tsconfig.json")
            .toString("utf8")
    );

    const { outDir } = parsedTsCompile["compilerOptions"];

    if (!outDir) {
        return;
    }

    return path.normalize(outDir)
}

function generateModFile(
    params: {
        packageJsonParsed: any;
        tsconfigOutDir: string | undefined;
        denoDistPath: string;
        explicitlyProvidedIndexFilePath: string | undefined;
        srcDirPath: string;
    }
) {

    const { 
        denoDistPath, 
        packageJsonParsed, 
        tsconfigOutDir, 
        explicitlyProvidedIndexFilePath, 
        srcDirPath 
    } = params;


    const indexFileRelativePath = getIndexFileRelativePath({ 
        packageJsonParsed, 
        tsconfigOutDir, 
        explicitlyProvidedIndexFilePath, 
        srcDirPath
    });

    //No need to generate a mod.ts files, user have explicitly provided one.
    if (fs.existsSync(path.join(srcDirPath, "mod.ts"))) {
        return;
    }

    if (indexFileRelativePath === undefined) {
        console.warn([
            `Denoify did not generate "mod.ts" file because your index wasn't found. You have two options:`,
            `1) You may create ${path.join(srcDirPath, "mod.ts")} it will be denoified and moved to ${denoDistPath}.`,
            `2) You can also specify where is your index using the denoify.index field in package.js`
        ].join("\n"));
        return;
    }

    if (fs.existsSync(path.resolve(denoDistPath, indexFileRelativePath))) {
        fs.writeFileSync(
            path.join(denoDistPath, "mod.ts"),
            Buffer.from(
                `export * from "${indexFileRelativePath.replace(/^(:?\.\/)?/, "./")}";`,
                "utf8"
            )
        );
    }
}


/** Relative to the src/ dir */
function getIndexFileRelativePath(
    params: {
        packageJsonParsed: any;
        tsconfigOutDir: string | undefined;
        explicitlyProvidedIndexFilePath: string | undefined;
        srcDirPath: string;
    }
): string | undefined {

    const { packageJsonParsed, tsconfigOutDir, explicitlyProvidedIndexFilePath, srcDirPath } = params;

    if( explicitlyProvidedIndexFilePath !== undefined ){

        return path.relative(
            srcDirPath,
            toPosix(explicitlyProvidedIndexFilePath)
        );

    }

    if (tsconfigOutDir === undefined) {
        return;
    }

    if (!("main" in packageJsonParsed)) {
        return;
    }

    if (!isInsideOrIsDir({
        "dirPath": tsconfigOutDir,
        "fileOrDirPath": path.normalize(packageJsonParsed["main"])
    })) {
        return;
    }

    const indexFileRelativePath = toPosix(
        path.relative(
            tsconfigOutDir,
            path.normalize(packageJsonParsed["main"]) // ./dist/lib/index.js
        ) // ./lib/index.js
            .replace(/\.js$/i, ".ts")
    )

    return indexFileRelativePath;

}
