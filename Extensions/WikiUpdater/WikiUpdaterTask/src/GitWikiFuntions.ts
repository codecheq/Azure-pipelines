import * as simplegit from "simple-git/promise";
import * as fs from "fs";
import * as rimraf from "rimraf";
import * as path from "path";
import * as process from "process";

// A wrapper to make sure that directory delete is handled in sync
function rimrafPromise (localpath)  {
    return new Promise((resolve, reject) => {
        rimraf(localpath, () => {
            resolve();
        }, (error) => {
            reject(error);
        });
    });
}

function mkDirByPathSync(targetDir, { isRelativeToScript = false } = {}) {
    const sep = path.sep;
    const initDir = path.isAbsolute(targetDir) ? sep : "";
    const baseDir = isRelativeToScript ? __dirname : ".";

    return targetDir.split(sep).reduce((parentDir, childDir) => {
      const curDir = path.resolve(baseDir, parentDir, childDir);
      try {
        fs.mkdirSync(curDir);
      } catch (err) {
        if (err.code === "EEXIST") { // curDir already exists!
          return curDir;
        }

        // To avoid `EISDIR` error on Mac and `EACCES`-->`ENOENT` and `EPERM` on Windows.
        if (err.code === "ENOENT") { // Throw the original parentDir error on curDir `ENOENT` failure.
          throw new Error(`EACCES: permission denied, mkdir '${parentDir}'`);
        }

        const caughtErr = ["EACCES", "EPERM", "EISDIR"].indexOf(err.code) > -1;
        if (!caughtErr || caughtErr && curDir === path.resolve(targetDir)) {
          throw err; // Throw if it's just the last created dir.
        }
      }

      return curDir;
    }, initDir);
  }

export function GetWorkingFolder(localpath, filename, logInfo): any {
    var pathParts = path.parse(filename);
    if (pathParts.dir && pathParts.dir !== "/" && pathParts.dir !== "\\") {
        var targetPath = path.join(localpath, path.join(pathParts.dir));
        if (!fs.existsSync(targetPath)) {
            logInfo(`Creating the directory ${targetPath}`);
            mkDirByPathSync(targetPath);
        }
        return targetPath;
    } else {
        logInfo(`No sub-directory passed change to ${localpath}`);
        return localpath;
    }
}

export function GetWorkingFile(filename, logInfo): any {
    var pathParts = path.parse(filename);
    var name = pathParts.base;
    logInfo(`Working file name is ${name}`);
    return name;
}

export async function UpdateGitWikiFile(repo, localpath, user, password, name, email, filename, message, contents, logInfo, logError, replaceFile) {
    const git = simplegit();

    let remote = "";
    let logremote = ""; // make sure we hide the password
    if (password === null) {
        remote = `https://${repo}`;
        logremote = remote;
    } else if (user === null) {
        remote = `https://${password}@${repo}`;
        logremote = `https://***@${repo}`;
    } else {
        remote = `https://${user}:${password}@${repo}`;
        logremote = `https://${user}:***@${repo}`;
    }
    logInfo(`URL used ${logremote}`);

    try {
        if (fs.existsSync(localpath)) {
            await rimrafPromise(localpath);
        }
        logInfo(`Cleaned ${localpath}`);

        await git.silent(true).clone(remote, localpath);
        logInfo(`Cloned ${repo} to ${localpath}`);

        await git.cwd(localpath);
        await git.addConfig("user.name", name);
        await git.addConfig("user.email", email);
        logInfo(`Set GIT values in ${localpath}`);

        // move to the working folder
        var workingPath = GetWorkingFolder(localpath, filename, logInfo);
        process.chdir(workingPath);

        // do git pull just in case the clone was slow and there have been updates since
        // this is to try to reduce concurrency issues
        await git.pull();
        logInfo(`Pull in case of post clone updates from other users`);

        // we need to change any encoded
        var workingFile = GetWorkingFile(filename, logInfo);
        if (replaceFile) {
            fs.writeFileSync(workingFile, contents.replace(/`n/g, "\r\n"));
            logInfo(`Created the ${workingFile} in ${workingPath}`);
        } else {
            fs.appendFileSync(workingFile, contents.replace(/`n/g, "\r\n"));
            logInfo(`Appended to the ${workingFile} in ${workingPath}`);
        }

        await git.add(filename);
        logInfo(`Added ${filename} to repo ${localpath}`);

        await git.commit(message);
        logInfo(`Committed to ${localpath} with message "${message}`);

        await git.push();
        logInfo(`Pushed to ${repo}`);
    } catch (error) {
        logError(error);
    }
}