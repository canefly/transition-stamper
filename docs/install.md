# Installing Transition Stamper (for editors)

You need **Premiere Pro 2026 (26.0) or newer** (check under *Help > About Premiere Pro*) and the file `com.stamper.cane_premierepro.ccx`.

You do **not** need Premiere's developer mode, and nothing is installed outside your user account.

## Option 1: double-click (try this first)

1. You can leave Premiere open. (In our tests it picked the plugin up without a restart.)
2. Double-click `com.stamper.cane_premierepro.ccx`.
3. If a window asks about a package from outside the Marketplace, choose **Install**. (Sometimes nothing visible happens: that is normal, the install runs in the background.)
4. In Premiere: **Window > UXP Plugins > Transition Stamper**. If it isn't in the menu yet, give it a few seconds, and if it still isn't there, restart Premiere (see "If it still doesn't show up").

If the panel shows up, you're done.

## Option 2: install from the command line (if Creative Cloud is acting up)

Use this if double-clicking does nothing, Creative Cloud errors out or hangs, or the plugin never appears in Premiere's menu. It skips the Creative Cloud window and talks to Adobe's installer directly.

**Windows:**

1. You can leave Premiere open (a restart wasn't needed in our tests).
2. Put the `.ccx` somewhere easy, like your Desktop.
3. Find the file's full path: right-click the `.ccx` and choose **Copy as path**. (Windows 11 shows this in the right-click menu. On Windows 10, hold **Shift** while right-clicking.)
4. Open **PowerShell**: press the Windows key, type `PowerShell`, press Enter.
5. Type `& "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install ` (note the space at the end), then **paste** the path you copied in step 3. The whole line should look like this:

   ```
   & "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent\UnifiedPluginInstallerAgent.exe" /install "C:\Users\YourName\Desktop\com.stamper.cane_premierepro.ccx"
   ```

6. Press **Enter**. You should see two lines: `Installing extension with file path = ...` and then `Installation Successful for extension with file path = ...`. If you don't see "Installation Successful", something went wrong: see the list below.
7. In Premiere: **Window > UXP Plugins > Transition Stamper**. The Creative Cloud app will also list it afterwards (under its plugins page, as "Transition Stamper, Installed").

**Mac:** Adobe's documentation gives the command as `./UnifiedPluginInstallerAgent --install <path to the .ccx>`, run from the folder that contains the installer agent. We have not tested this on a Mac and haven't confirmed where the agent lives there, so treat this as a starting point.

## If it still doesn't show up

- **Restart Premiere.** It normally picks a new plugin up without one, but if the panel isn't listed, quit it completely (check the taskbar and Task Manager for a leftover "Adobe Premiere Pro") and open it again.
- **Check your Premiere version.** Older than 2026 (26.0) won't install it or won't list it.
- **"Cannot find path" or "not recognized" in PowerShell:** the installer isn't at that location. Search for `UnifiedPluginInstallerAgent.exe` inside `C:\Program Files\Common Files\Adobe` and use the path you find instead.
- **Quotes matter:** the installer path and the `.ccx` path each need to be wrapped in quotes if they contain spaces.
- **Updating to a newer version:** run the install again with the newer `.ccx`; it installs over the old one.

## Where it ends up (for the curious)

On Windows the plugin is unpacked to `%APPDATA%\Adobe\UXP\Plugins\External\com.stamper.cane_<version>\` and registered in `%APPDATA%\Adobe\UXP\PluginsInfo\v1\premierepro.json`. Don't copy files into that folder by hand: the registration file is what makes Premiere load it. More detail in [release.md](release.md).
