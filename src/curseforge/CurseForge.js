import React, { useState, useRef, useEffect } from "react";
import { Table, Button, Icon, Dropdown, Tab } from "semantic-ui-react";

import { AddonStore, InstallButton } from "../utils";

const ipcRenderer = window.require("electron").ipcRenderer;
const fs = window.require("fs");
const extract = window.require("extract-zip");

const STOREKEY = "addons.curseforge";
const GAMEVERSION = "1.13.2";

/*
Unofficial twitch api doc:
    https://twitchappapi.docs.apiary.io
*/

const updateAddon = async (id, currentVersion) => {
    const response = await fetch(
        "https://addons-ecs.forgesvc.net/api/v2/addon/" + id
    );
    const data = await response.json();

    // Pick only the latest file with the right game version
    let latestFile = {};
    const BreakException = {};
    try {
        data.latestFiles.forEach(file => {
            file.gameVersion.forEach(version => {
                if (version === GAMEVERSION) {
                    latestFile = file;
                    throw BreakException;
                }
            });
        });
    } catch (e) {}

    AddonStore.set(STOREKEY + "." + id, {
        id: id,
        name: data.name,
        version: currentVersion || latestFile.displayName,
        downloadUrl: latestFile.downloadUrl,
        downloadCount: data.downloadCount,
        websiteUrl: data.websiteUrl
    });
    return latestFile.displayName;
};

const Addon = props => {
    const [loading, setLoading] = useState(false);
    const refVersion = useRef(props.version);
    const refLatestVersion = useRef(null);

    useEffect(() => {
        // Don't reload if not needed
        if (props.version === refLatestVersion.current) {
            return;
        }
        setLoading(true);
        updateAddon(props.id, props.version).then(v => {
            refLatestVersion.current = v;
            setLoading(false);
        });
    }, [props.id, props.version]);

    const install = async () => {
        const promise = new Promise(resolve => {
            const path = AddonStore.get("path");
            ipcRenderer.send("download", {
                url: props.downloadUrl,
                properties: { directory: path }
            });
            ipcRenderer.once("download complete", (event, file) => {
                extract(file, { dir: path }, err => {
                    if (err) console.log(err);
                    // Silently remove zip file
                    try {
                        fs.unlinkSync(file);
                    } catch (e) {}
                    refVersion.current = refLatestVersion.current;
                    AddonStore.set(
                        [STOREKEY, props.id, "version"].join("."),
                        refVersion.current
                    );
                    resolve();
                });
            });
        });
        await promise;
    };

    const installButton =
        refLatestVersion.current !== props.version ? (
            // Update available
            <InstallButton
                color="green"
                loading={loading}
                disabled={loading}
                onClick={async () => await install()}
            >
                <Icon name="download" />
                {refLatestVersion.current}
            </InstallButton>
        ) : (
            <InstallButton
                color="blue"
                loading={loading}
                disabled={loading}
                onClick={async () => await install()}
            >
                <Icon name="download" />
                {props.version}
            </InstallButton>
        );

    return (
        <Table.Row>
            <Table.Cell collapsing>
                <Button
                    color="red"
                    icon="trash alternate"
                    onClick={() => AddonStore.delete(STOREKEY + "." + props.id)}
                />
            </Table.Cell>
            <Table.Cell>
                <a
                    href={props.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <Icon name="external alternate" />
                    {props.name}
                </a>
            </Table.Cell>
            <Table.Cell collapsing textAlign="center">
                {props.downloadCount}
            </Table.Cell>
            <Table.Cell collapsing textAlign="center">
                {installButton}
            </Table.Cell>
        </Table.Row>
    );
};

const AddonSearch = props => {
    const [loading, setLoading] = useState(false);
    const refAddonList = useRef([]);
    const refSearchTimeout = useRef(null);

    const customSearch = (e, { searchQuery }) => {
        if (searchQuery.length === 0) return;
        if (refAddonList.current.length > 0 && searchQuery.length > 4) return;
        setLoading(true);
        clearTimeout(refSearchTimeout.current);
        refSearchTimeout.current = setTimeout(() => {
            fetch(
                "https://addons-ecs.forgesvc.net/api/v2/addon/search?gameId=1&gameVersion=" +
                    GAMEVERSION +
                    "&searchFilter=" +
                    searchQuery
            )
                .then(response => response.json())
                .then(
                    data =>
                        (refAddonList.current = data.map(addon => ({
                            key: addon.id,
                            value: addon.id,
                            text: addon.name,
                            description: addon.summary
                        })))
                )
                .then(() => {
                    clearTimeout(refSearchTimeout.current);
                    refSearchTimeout.current = null;
                    setLoading(false);
                });
        }, 500);
    };

    return (
        <Dropdown
            fluid
            selection
            search
            onSearchChange={customSearch}
            loading={loading}
            placeholder="Search addon"
            options={refAddonList.current}
            onChange={(_, { value }) => updateAddon(value, null)}
            selectOnBlur={false}
            selectOnNavigation={false}
        />
    );
};

export const CFTab = props => {
    const [addons, setAddons] = useState([]);
    const refTimer = useRef(null);

    useEffect(() => {
        setAddons(Object.values(AddonStore.get(STOREKEY, {})));
        AddonStore.onDidChange(STOREKEY, (newValue, oldValue) => {
            clearTimeout(refTimer.current);
            refTimer.current = setTimeout(() => {
                setAddons(Object.values(newValue || {}));
                refTimer.current = null;
            }, 100);
        });
    }, []);

    return (
        <Tab.Pane {...props}>
            <AddonSearch />
            <Table selectable celled>
                <Table.Header>
                    <Table.Row>
                        <Table.HeaderCell />
                        <Table.HeaderCell>Name</Table.HeaderCell>
                        <Table.HeaderCell collapsing textAlign="center">
                            Downloads
                        </Table.HeaderCell>
                        <Table.HeaderCell collapsing textAlign="center" />
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {addons.map(addon => (
                        <Addon key={addon.id} {...addon} />
                    ))}
                </Table.Body>
            </Table>
        </Tab.Pane>
    );
};
