import {Octokit} from "octokit"
const sodium = require('libsodium-wrappers')
const fs = require('fs');

interface Actor {
    token: string
}

interface Secret {
    name: string,
    plainValue: string,
    encryptedValue: string | undefined
}

interface PublicKey {
    key_id: string,
    key: string
}

interface Repository {
    name: string,
    owner: string,
    publicKey: PublicKey | undefined,
    secrets: Secret[],
}

interface ConfigActor {
    token: string
}

interface ConfigRepository {
    name: string,
    owner: string,
}

interface ConfigSecret {
    name: string,
    value: string
}

const publishSecret = async (actor: Actor, repository: Repository) => {
    const octokit = new Octokit({
        auth: actor.token
    })

    repository.publicKey = (await octokit.request(`GET /repos/${repository.owner}/${repository.name}/actions/secrets/public-key`, {
        owner: repository.owner,
        repo: repository.name,
        headers: {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    })).data as unknown as PublicKey

    if (!repository.publicKey || !repository.publicKey.key ) {
        console.error("Public key was undefined")
        throw new Error("Public key was undefined")
    }

    for (const secret of repository.secrets) {
        secret.encryptedValue = await buildEncryptedSecret(secret, repository.publicKey)
        const response = await octokit.request(`PUT /repos/${repository.owner}/${repository.name}/actions/secrets/${secret.name}`, {
            owner: repository.owner,
            repo: repository.name,
            secret_name: secret,
            encrypted_value: secret.encryptedValue,
            key_id: repository.publicKey.key_id,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28'
            }
        })
        console.log(`Updated ${repository.owner}/${repository.name} ${secret.name} with response ${response.status}`)
    }
}

const buildEncryptedSecret = (secret: Secret, publicKey: PublicKey) => {
        return sodium.ready.then(() => {
            let binkey = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL)
            let binsec = sodium.from_string(secret.plainValue)
            let encBytes = sodium.crypto_box_seal(binsec, binkey)
            return sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL)
        });
}

console.log("Loading Config")
const configActor = JSON.parse(fs.readFileSync('./assets/actor.json', 'utf8')) as unknown as ConfigActor;
const configRepositories = JSON.parse(fs.readFileSync('./assets/repositories.json', 'utf8')) as unknown as ConfigRepository[];
const configSecrets = JSON.parse(fs.readFileSync('./assets/secrets.json', 'utf8')) as unknown as ConfigSecret[];
console.log("Config loaded")


const secrets: Secret[] = configSecrets.map(configSecret => {
    return {
        encryptedValue: undefined,
        plainValue: configSecret.value,
        name: configSecret.name
    }
})

const actor: Actor = {
    token: configActor.token
}

configRepositories.forEach(configRepository => {
    console.log(`Updating secrets for ${configRepository.owner}/${configRepository.name}`)
    const repository: Repository = {
        name: configRepository.name,
        owner: configRepository.owner,
        publicKey: undefined,
        secrets: secrets
    }
    publishSecret(actor, repository)
        .then(_ => console.log(`Successfully updated repo ${configRepository.owner}/${configRepository.name}`))
        .catch(_ => {console.error(`something went wrong with ${configRepository.owner}/${configRepository.name}`)
    })
})