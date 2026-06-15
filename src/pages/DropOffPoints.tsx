import React from 'react';
import { ShippingPointContent } from '../components/ShippingPointContent';

const DropOffPoints: React.FC = () => {
    return (
        <ShippingPointContent
            mode="page"
            tableName="custom_locations"
            headerTitle="កំណត់ទីតាំងទម្លាក់ទំនិញ (Drop-off Points)"
            pageTitle="កំណត់ទីតាំងទម្លាក់ទំនិញ (Drop-off Points)"
            pageSubtitle="បង្កើតទីតាំងទម្លាក់ទំនិញសម្រាប់ការចាត់ថ្នាក់ ឬស្វែងរក (Pin drop-off locations for easier access)"
            mapSource="osm"
        />
    );
};

export default DropOffPoints;
