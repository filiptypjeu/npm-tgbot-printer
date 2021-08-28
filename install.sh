#!/bin/bash
USERNAME="pi"
GIT_FOLDER="/home/$USERNAME/TranslateBot.git"
TREE_FOLDER="/home/$USERNAME/TranslateBot"
AUTH_FOLDER="$TREE_FOLDER/auth"
AUTH_FILE="$AUTH_FOLDER/translatebot-key.json"
HOOK_FILE="$GIT_FOLDER/hooks/post-receive"

if [ ! -d $GIT_FOLDER ]; then
    sudo mkdir -p $GIT_FOLDER
    sudo chown -R $USERNAME $GIT_FOLDER
    echo "Folder $GIT_FOLDER created for git repository."
else
    echo "Folder $GIT_FOLDER already exists."
fi


if [ ! -d $TREE_FOLDER ]; then
    sudo mkdir -p $TREE_FOLDER
    sudo chown -R $USERNAME $TREE_FOLDER
    echo "Folder $TREE_FOLDER created for git file tree."
else
    echo "Folder $TREE_FOLDER already exists."
fi


if [ ! -d $AUTH_FOLDER ]; then
    mkdir -p $AUTH_FOLDER
    echo "Folder $AUTH_FOLDER created for Google Cloud API key."
else
    echo "Folder $AUTH_FOLDER already exists."
fi


if [ $(ls -l $AUTH_FOLDER | grep -c nyagamlabot-key.json) == 1 ]; then
    echo "Google Cloud API private key found."
else
    echo "No Google Cloud API private key found. Requesting private key..."
fi


echo "Getting latest Node.js repository..."
curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash - > /dev/null
echo "Done."


echo "Getting latest Google Cloud SDK repository..."
echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee -a /etc/apt/sources.list.d/google-cloud-sdk.list > /dev/null
echo "Done."


echo "Adding Google Cloud API key..."
sudo apt-get install apt-transport-https ca-certificates
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key --keyring /usr/share/keyrings/cloud.google.gpg add -
export GOOGLE_APPLICATION_CREDENTIALS=$AUTH_FILE
echo "Done."


echo "Updating repositories..."
sudo apt-get update > /dev/null
echo "Done."


echo "Installing repositories..."
sudo apt-get install -y nodejs node-typescript sox libsox-fmt-all google-cloud-sdk cups pigpio > /dev/null
echo "Done."


echo "Initializing git folder in $GIT_FOLDER..."
cd $GIT_FOLDER
git init --bare
echo "Done."


echo '#!/bin/bash
TREE_FOLDER='$TREE_FOLDER'
GIT_FOLDER='$GIT_FOLDER'
BRANCH="master"

while read oldrev newrev ref
do
    # only checking out the master (or whatever branch you would like to deploy)
    if [[ $ref = refs/heads/$BRANCH ]];
    then
            echo "Ref $ref received. Deploying ${BRANCH} branch to production..."
            git --work-tree=$TREE_FOLDER --git-dir=$GIT_FOLDER checkout -f
            cd $TREE_FOLDER && npm run deploy
    else
            echo "Ref $ref received. Doing nothing: only the ${BRANCH} branch may be deployed on this server."
    fi
done' > $HOOK_FILE
chmod +x $HOOK_FILE
echo "Git post-receive hook created."


echo "Installation complete."
